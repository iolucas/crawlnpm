var async = require("async");
var neo4j = require('node-neo4j');
var npmApi = require("./npmapi.js");
var fs = require("fs");

//Utils
var print = console.log;

//Create error log file
var errorLog = "------------ NPM Crawl Error Log ------------\r\n\r\n\r\n";
var errorLogFileName = "logs/error_log_" + Math.random()*1000 + ".txt";
fs.writeFileSync(errorLogFileName, errorLog);

var writeErrorLog = function(log) {
    if(log == null)
        return;

    var logText;
    
    try {
        logText = JSON.stringify(log);
    } catch (e){
        logText = log;
    } finally {
        //errorLog += logText + "\r\n\r\n\r\n";
        fs.appendFileSync(errorLogFileName, logText + "\r\n\r\n\r\n");
    }
    
}

var db = new neo4j('http://neo4j:lucas@localhost:7474');

//Define constraints
var modulePathConstraint = "CREATE CONSTRAINT ON (module:Module) ASSERT module.path IS UNIQUE";

print("Initing db...")
//Execute constraint set query
db.cypherQuery(modulePathConstraint, function(err) {
    if(err)
        print(err);
    else {
        print("Db initiated");
        main(process.argv);
    }
});


function main(argv) {

    switch(argv[2]) {

        case "--all-empty":
            var limit = argv[3] || 10;
            //Get all modules that does not have a title
            db.cypherQuery("MATCH (n:Module) WHERE NOT exists(n.title) return n LIMIT " + limit, function(err, result) {
                if(err)
                    return print(err);
                
                //Populate target paths
                var targetPaths = [];
                for(var i = 0; i < result.data.length; i++)
                    targetPaths.push(result.data[i].path);

                //Run crawl
                crawlNpmPathCollection(targetPaths, function() {
                    print("DONE");
                });
            });
            break;

        default:
            crawlNpmPathCollection([argv[2]], function() {
                print("DONE");
            });
    }






    /*crawlCollection(['cfenv', 'express'], function() {
        console.log("DONE");
    });*/


    /*crawlUnique(argv[2], function() {
        console.log(arguments);

    });*/


    /*npmApi.getNpmModuleData(process.argv[2], function(err, data) {
        console.log(err);
        console.log(data);
    });*/

}



//Crawl any collection of wikipedia urls
function crawlNpmPathCollection(urlCollection, callback) {

    var urlQty = urlCollection.length;
    var downloadsLeft = urlCollection.length;
    var doneQty = 0;

    print("Pages left: " + downloadsLeft);

    var urlCollectionEmptyFlag = false;

    //Queue to handle addition of items into the database
    var databaseQueue = async.queue(function(moduleData, taskCallback) {
        
        //Add this module data to the database
        addNpmModuleToDb(moduleData, function(err) {
            if(err)
                console.log(err);

            taskCallback(err, moduleData.path);
        });

    }, 1);

    //Callback to be called when the database queue are empty
    databaseQueue.drain = function() {
        console.log("Database queue is empty.");

        //If the url collection to be download is empty, call the finish callback
        if(urlCollectionEmptyFlag)
            callback();
    }

    //Queue to handle the download of the wikipedia pages
    var npmPathQueue = async.queue(function(path, taskCallback) {

        print("Getting data of module: '" + path + "'");

        npmApi.getNpmModuleData(path, function(error, moduleData) {
            downloadsLeft--;
            
            //If error, exit with it
            if(error) {
                taskCallback(getErrorString(error, 
                    "Crawl Error with module: '" + path + "': "), path);
                return;
            }

            //Push this pageinfo to the database queue
            databaseQueue.push(moduleData, function(err, modulePath) {
                doneQty++;
                if(err) {
                    var errorString = getErrorString(err, 
                        "Error while adding data to database from url " + modulePath + ": ");
                    print(errorString);
                    writeErrorLog(errorString);
                } else {
                    print("Module '" + modulePath + "' added to the database.");
                } 
                print("Modules done: " + doneQty + "/" + urlQty);
            
                //Call the task finish callback
                taskCallback(null, path);

            });


        });

    }, 3);

    //Callback to be called when the wikipages queue are empty
    npmPathQueue.drain = function() {
        print("Npm paths queue is empty.");
        urlCollectionEmptyFlag = true;
    }

    npmPathQueue.push(urlCollection, function(err, path){
        if(err) {
            var errorString = getErrorString(err, "Error while downloading page: " + path);
            print(errorString);
            writeErrorLog(errorString);
        } else {
            print("Module '" + path + "' downloaded. Modules left: " + downloadsLeft);
        }
    });
}


function addNpmModuleToDb(moduleData, callback) {

    var data = moduleData;

    //Create query to create or update module data
    var createOrMatchQuery = "MERGE (n:Module {path:'" + data.path +"'})";

    //Query to update stuff
    var updateOptions = {
        title: data.title,
        description: data.description || "",
        githubAddr: data.githubAddr || "",
        //lastPublishUser: data.lastPublisher.publisher || "",
        //lastPublishDate: data.lastPublisher.date || "",
        //lastPublishDateFormat: data.lastPublisher.format || "",
        lastRelease: data.lastRelease || "",
        dailyDownloads: data.stats.dailyDownloads || "",
        weeklyDownloads: data.stats.weeklyDownloads || "",
        monthlyDownloads: data.stats.monthlyDownloads || ""
    }

    var createQuery = "";

    createQuery += "SET";
    for (var key in updateOptions) {
        var value = updateOptions[key];
        if((typeof value) == 'string')
            value = '"' + value + '"';

        createQuery += " n." + key + " = " + value + ", ";
    }
    createQuery = createQuery.substr(0, createQuery.length - 2);


    //Query to create keywords
    var keywordsQuery = "";
    for(var i = 0; i < data.keywords.length; i++) {
        var keywordTitle = data.keywords[i];
        keywordsQuery += "MERGE (k" + i + ":Keyword {title:'" + keywordTitle +"'}) CREATE UNIQUE (k" + i + ")<-[:Keyword]-(n) ";
    }

    //Query to create dependences
    var dependentsQuery = "";
    //for (var key in data.dependenciesPaths) {
    for(var i = 0; i < data.dependenciesPaths.length; i++) {
        var dependencePath = data.dependenciesPaths[i];
        dependentsQuery += "MERGE (dc" + i + ":Module {path:'" + dependencePath +"'}) CREATE UNIQUE (dc" + i + ")<-[:DependsOf]-(n) ";
    }

    //Query to create dependents
    for(var i = 0; i < data.dependentsPaths.length; i++) {
        var dependentPath = data.dependentsPaths[i];
        dependentsQuery += "MERGE (dt" + i + ":Module {path:'" + dependentPath +"'}) CREATE UNIQUE (dt" + i + ")-[:DependsOf]->(n) ";
    }

    //console.log(keywordsQuery);

    var neoQuery = [createOrMatchQuery, createQuery, keywordsQuery,dependentsQuery].join(" ");
    //console.log(neoQuery);

    db.cypherQuery(neoQuery, function(err, result) {
        callback(err, result);
    });
}



function crawlCollection(paths, callback) {

    var asyncQueue = async.queue(function(path, taskCallback) {
        print("Crawling " + path + " ...");
        crawlUnique(path, function(err) {
            if(err)
                console.log(err);

            print("Done with " + path + ".");
            taskCallback();
        });

    },1);

    asyncQueue.drain = function() {
        callback();
    }

    asyncQueue.push(paths, function() {
        console.log(arguments);
    });
}

function crawlUnique(path, callback) {

    npmApi.getNpmModuleData(path, function(err, data) {
        if(err)
            return callback(err);

        console.log(data);

        //Create query to create or update module data
        var createOrMatchQuery = "MERGE (n:Module {path:'" + data.path +"'})";

        //Query to update stuff
        var updateOptions = {
            title: data.title,
            description: data.description || "",
            githubAddr: data.githubAddr || "",
            //lastPublishUser: data.lastPublisher.publisher || "",
            //lastPublishDate: data.lastPublisher.date || "",
            //lastPublishDateFormat: data.lastPublisher.format || "",
            lastRelease: data.lastRelease || "",
            dailyDownloads: data.stats.dailyDownloads || "",
            weeklyDownloads: data.stats.weeklyDownloads || "",
            monthlyDownloads: data.stats.monthlyDownloads || ""
        }

        var createQuery = "";

        createQuery += "SET";
        for (var key in updateOptions) {
            var value = updateOptions[key];
            if((typeof value) == 'string')
                value = '"' + value + '"';

            createQuery += " n." + key + " = " + value + ", ";
        }
        createQuery = createQuery.substr(0, createQuery.length - 2);


        //Query to create keywords
        var keywordsQuery = "";
        for(var i = 0; i < data.keywords.length; i++) {
            var keywordTitle = data.keywords[i];
            keywordsQuery += "MERGE (k" + i + ":Keyword {title:'" + keywordTitle +"'}) CREATE UNIQUE (k" + i + ")<-[:Keyword]-(n) ";
        }

        //Query to create dependences
        var dependentsQuery = "";
        //for (var key in data.dependenciesPaths) {
        for(var i = 0; i < data.dependenciesPaths.length; i++) {
            var dependencePath = data.dependenciesPaths[i];
            dependentsQuery += "MERGE (dt" + i + ":Module {path:'" + dependencePath +"'}) CREATE UNIQUE (dt" + i + ")<-[:DependsOf]-(n) ";
        }

        //Query to create dependents
        for(var i = 0; i < data.dependentsPaths.length; i++) {
            var dependentPath = data.dependentsPaths[i];
            dependentsQuery += "MERGE (dc" + i + ":Module {path:'" + dependentPath +"'}) CREATE UNIQUE (dc" + i + ")-[:DependsOf]->(n) ";
        }

        //console.log(keywordsQuery);

        var neoQuery = [createOrMatchQuery, createQuery, keywordsQuery,dependentsQuery].join(" ");
        //console.log(neoQuery);

        db.cypherQuery(neoQuery, function(err, result) {
            callback(err, result);
        });
    });
}


function getErrorString(errorObj, errorMsg) {
    var errorString;
    try {
        errorString = JSON.stringify(errorObj);
    } catch(e) {
        errorString = errorObj;
    } finally {
        return errorMsg + errorString;
    }
}



/*request("https://www.npmjs.com/package/colors", function(error, response, body) {
    $ = cheerio.load(body);

    var pageTitle = $('h1.package-name a').html();
    var description = $('p.package-description').html();
    var githubAddr;

    $('ul.box li a').each(function(){
        if(githubAddr != undefined)
            return;

        var href = $(this).attr('href');
        if(href.match(/github\.com/))
            githubAddr = href;
    });

    console.log(pageTitle);
    console.log(description);
    console.log(githubAddr);
});*/