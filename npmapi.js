//Module to get data from npm site

//Module to perform http requests
var request = require("request");

//Module to parse html content "jquery like"
var cheerio = require("cheerio");

module.exports = {
    getNpmModuleData: getNpmModuleData    
}

function getNpmModuleData(modulePath, callback) {

    request("https://www.npmjs.com/package/" + modulePath, function(error, response, body) {
        if(error)
            return callback(error, response, body);

        $ = cheerio.load(body);

        var pagePath = modulePath;
        var pageTitle = $('h1.package-name a').html();
        
        if(pageTitle == null)
            return callback("Page not returned. (Maybe wrong path or server error.)");


        var description = $('p.package-description').html();

        var githubAddr;
        var lastPublisher = {
            publisher: $("li.last-publisher").children('a').attr('href'),
            date: $("li.last-publisher").children('span').attr('data-date'),
            format: $("li.last-publisher").children('span').attr('data-date-format')
        }

        var lastRelease;
        
        $("div.sidebar ul.box").children("li").not(".last-publisher").children("strong").each(function(){
            if(lastRelease == undefined)
                lastRelease = $(this).text();
        });

        var stats;
        var statsNode = false;
        $("div.sidebar").children().each(function(index, tagData) {
            if(statsNode && !stats ) {
                stats = {
                    dailyDownloads: $(this).find("strong.daily-downloads").text(),
                    weeklyDownloads: $(this).find("strong.weekly-downloads").text(),
                    monthlyDownloads: $(this).find("strong.monthly-downloads").text(),
                }
                
            } else if(tagData.name == 'h3' && $(this).text() == 'Stats'){
                statsNode = true;
            }
        });

        var keywords = [];

        var dependenciesPaths = [];
        var dependentsPaths = [];

        //Get github addr
        $('ul.box li a').each(function(){
            if(githubAddr != undefined)
                return;

            var href = $(this).attr('href');
            if(href.match(/github\.com/))
                githubAddr = href;
        });

        //Get keywords
        $('p.list-of-links a').each(function() {
            var match = $(this).attr("href").match(new RegExp("^/browse/keyword/(.+)"));
            if(match)
                keywords.push(match[1]);
        });

        //Get dependencies paths
        $('div.sidebar p.list-of-links:not(".dependents") a').each(function() {
            var match = $(this).attr("href").match(new RegExp("^/package/(.+)"));
            if(match)
                dependenciesPaths.push(match[1]);
        });

        //Get dependents paths
        $('div.sidebar p.list-of-links.dependents a').each(function() {
            var match = $(this).attr("href").match(new RegExp("^/package/(.+)"));
            if(match)
                dependentsPaths.push(match[1]);
        });

        //Fire callback successfully
        callback(null, {
            title: pageTitle,
            description: description,
            keywords: keywords,
            path: pagePath,
            githubAddr: githubAddr,
            lastPublisher: lastPublisher,
            lastRelease: lastRelease,
            stats: stats || {},
            dependenciesPaths: dependenciesPaths,
            dependentsPaths: dependentsPaths
        });
    });
}