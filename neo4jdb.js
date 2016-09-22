var neo4j = require('node-neo4j');
var Promise = require("bluebird");

var async = require("async");

var db; //Database connection

//Function to escape regex special characters
RegExp.escape = function(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\\\$&");
}

module.exports = new neo4jDB();

//Module to store the grapho database related stuff

function neo4jDB() {

    var self = this;

    this.init = function(callback) {

        //Extern models
        self.models = {
            Wikiurl: WikiurlModel,
            Article: ArticleModel,
            ArticleLink: {}
        }

        //Connect to db
        db = new neo4j('http://neo4j:lucas@localhost:7474');


        //Define constraints
        var urlLangConstraint = "CREATE CONSTRAINT ON (wikiurl:Wikiurl) ASSERT wikiurl.url_lang IS UNIQUE";
        var wikiPageIdConstraint = "CREATE CONSTRAINT ON (article:Article) ASSERT article.wikiPageId IS UNIQUE";

        var asyncQueue = async.queue(function(constQuery, taskCallback) {
            //console.log(constQuery);
            db.cypherQuery(constQuery, function(err, result) {
                taskCallback(err); //Fire the taskCallback
            });
        }, 1)

        //Once tasks ends
        asyncQueue.drain = function() {
            callback(); //Fire callback successfully
        }

        //Push all the queries to the queue
        asyncQueue.push([urlLangConstraint, wikiPageIdConstraint], function(err) {
            if(err)
                callback(err); //Fire callback if some error
        });
    }
}

var baseModel = new function() {

    this.checkInheritance = function() {
        if(!this.model)
            throw "This model must be inherited.";
    }

    this.findOne = function(options) {
        this.checkInheritance();

        var self = this;

        return new Promise(function(resolve, reject) {

            if(!options.where)
                return reject("where object is missing on findOne");

            //Construct where object
            var matchQuery = "MATCH (matched:" + self.model + ")";

            var whereObjQuery = getFindWhereQuery(options.where, "matched");
            
            var returnQuery = "RETURN matched LIMIT 1";
            var neoQuery = [matchQuery, whereObjQuery, returnQuery].join(" ");

            //console.log(neoQuery);

            db.cypherQuery(neoQuery, function(err, result) {
                if(err) 
                    reject(err);
                else {
                    if(result.data.length == 0)
                        return reject("No results found.");
                     
                    var baseModelData = new self(result.data[0]);
                    resolve(baseModelData); //Resolve signaling when it is created
                }
            });
        });
    }

    this.findAll = function(options) {
        this.checkInheritance();

        var self = this;

        return new Promise(function(resolve, reject) {

            if(!options.where)
                return reject("where object is missing on findAll");

            //Construct where object
            var matchQuery = "MATCH (matched:" + self.model + ")";

            var whereObjQuery = getFindWhereQuery(options.where, "matched");
            

            var returnQuery = "RETURN matched";
            
            //Put a limit if it has been set
            if(options.limit)
                returnQuery += " LIMIT " + options.limit;
            else
                returnQuery += " LIMIT 1000"; //Safety limit in case not specified    


            var neoQuery = [matchQuery, whereObjQuery, returnQuery].join(" ");

            //console.log(neoQuery);

            db.cypherQuery(neoQuery, function(err, result) {
                if(err) 
                    reject(err);
                else {
                    if(result.data.length == 0)
                        return reject("No results found.");
                     
                    var baseModelDataArray = [];
                    result.data.forEach(function(resultData) {
                        baseModelDataArray.push(new self(resultData));    
                    }, this);

                    resolve(baseModelDataArray); //Resolve signaling when it is created
                }
            });
        });
    }

    this.findOrCreate = function(options) {
        this.checkInheritance();

        var self = this;

        return new Promise(function(resolve, reject) {

            if(!options.where)
                return reject("where object is missing on findOrCreate");

            //Construct where object
            var whereObjQuery = getWhereQuery(options.where);

            var matchQuery = "OPTIONAL MATCH (matched:" + self.model + " ";
            matchQuery += whereObjQuery + ")";

            var mergeQuery = "MERGE (node:" + self.model + " ";
            mergeQuery += whereObjQuery + ")";

            var createQuery = "";
            if(options.defaults) {
                createQuery += "ON CREATE SET";
                for (var key in options.defaults) {
                    var value = options.defaults[key];
                    if((typeof value) == 'string')
                        value = '"' + value + '"';

                    createQuery += " node." + key + " = " + value + ", ";
                }
                createQuery = createQuery.substr(0, createQuery.length - 2);
            }
            
            var returnQuery = "RETURN node, matched";
            var neoQuery = [matchQuery, "WITH matched", mergeQuery, createQuery, returnQuery].join(" ");

            //console.log(neoQuery);
            db.cypherQuery(neoQuery, function(err, result) {
                if(err) 
                    reject(err);
                else {
                    var created = result.data[0][1] ? false : true;
                    var articleData = new self(result.data[0][0]);
                    resolve([articleData, created]); //Resolve signaling when it is created
                    //must create function to the obj instance
                }
            });
        });
    }

    function getFindWhereQuery(whereObject, matchVar) {
        var whereQuery = "WHERE "

        var whereValues = [];

        for (var key in whereObject) {
            var value = whereObject[key];

            var whereValue = "";

            //Adjust key string
            if(key == "id") {
                key = "id(" + matchVar + ")";
            } else {
                key = matchVar + "." + key;
            }

            //Check some particular code to apply

            //If the value passed is equal to null
            if(value == null)
                whereValue += key + " IS NULL";   
            //If we should apply regex 
            else if((typeof value) == 'string')
                whereValue += key + " =~ '(?i)" + RegExp.escape(value) + "'";
            //If none of the above, return normal key/value
            else
                whereValue += key + " = " + value;

            whereValues.push(whereValue);
        }

        return whereQuery + whereValues.join(" AND ");
    }


    function getWhereQuery(whereObject) {
        var whereObjQuery = "{ ";
        for (var key in whereObject) {
            if(key == "id")
                continue;
            var value = whereObject[key];

            whereObjQuery += key + ":"

            if((typeof value) == 'string')
                value = '"' + value + '"';

            whereObjQuery += value + ", ";
        }

        //In case no args on where object, return empty
        if(whereObjQuery.length <= 3)
            return "";

        whereObjQuery = whereObjQuery.substr(0, whereObjQuery.length - 2);
        whereObjQuery += " }";

        return whereObjQuery;
    }
}

//keep reading about graph applications
//start think in an alpha implementation
//read about ex classification


var ArticleModel = function(articleData) {

    //Copy all data from the object data to this model
    for (var key in articleData)
        this[key] = articleData[key];

    this.id = this._id;

    //articleRef.addRedirectUrl(wikiurlRef);
    this.addRedirectUrl = function(wikiurl) {
        var self = this;
        return new Promise(function(resolve, reject) {

            var matchWikiurlQuery = "MATCH (url:Wikiurl) WHERE id(url) = " + wikiurl._id;
            var setArticleIdQuery = "SET url.articleId = " + self._id + " WITH url";
            var matchArticleQuery = "MATCH (art:Article) WHERE id(art) = " + self._id;
            var createUniqueRedirectToQuery = "CREATE UNIQUE (url)-[:RedirectsTo]->(art)";

            var neoQuery = [matchWikiurlQuery, setArticleIdQuery, matchArticleQuery, createUniqueRedirectToQuery].join(" ");

            console.log(neoQuery);
            db.cypherQuery(neoQuery, function(err) {
                if(err) 
                    reject(err);
                else
                    resolve();
            });
        });
    } 
    
    this.addLinkFromHere = function(wikiurl) {
        var self = this;
        return new Promise(function(resolve, reject) {

            var matchArticleQuery = "MATCH (art:Article) WHERE id(art) = " + self._id;
            var matchWikiurlQuery = "MATCH (url:Wikiurl) WHERE id(url) = " + wikiurl._id;
            var createUniqueRedirectToQuery = "CREATE UNIQUE (art)-[:LinksTo]->(url)";

            var neoQuery = [matchArticleQuery, matchWikiurlQuery, createUniqueRedirectToQuery].join(" ");

            console.log(neoQuery);
            db.cypherQuery(neoQuery, function(err) {
                if(err) 
                    reject(err);
                else
                    resolve();
            });
        });        
    }

    this.getLinkFromHere = function() {
        var self = this;
        return new Promise(function(resolve, reject) {
            //MATCH (n:Article)-[:LinksTo]->(t) WHERE id(n) = 326 RETURN t

            var neoQuery = "MATCH (n:Article)-[:LinksTo]->(t) WHERE id(n) = " + self._id + " RETURN t";

            db.cypherQuery(neoQuery, function(err, results) {
                if(err) 
                    return reject(err);

                if(results.length == 0)
                    return reject("No results returned.");
                
                var resultObjs = [];
                for (var i = 0; i < results.data.length; i++)
                    resultObjs.push(new WikiurlModel(results.data[i]));  

                resolve(resultObjs);
            });
        }); 
    }   
}

var WikiurlModel = function(wikiurlData){
    //Copy all data from the object data to this model
    for (var key in wikiurlData)
        this[key] = wikiurlData[key];

    this.id = this._id;
}

ArticleModel.model = 'Article';
WikiurlModel.model = 'Wikiurl';
ArticleModel.__proto__ = baseModel;
WikiurlModel.__proto__ = baseModel;



