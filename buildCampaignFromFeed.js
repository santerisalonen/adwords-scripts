/*************

Campaign updater 1.0.1

Description:
Syncs feed content with Adwords
 
**************/
var debug = false; 
var scriptName = '';
var emailRecipient = ''; 

var config = {
  source : '<url>',
  campaignPrefix : 'MYTEST_',
  budget : 10, 
  adGroupName : "{id}", 
  defaultBid : 1,
  bidFormula : "if( {views} > 300 ) { {b_rate} * 50 }", 
  // pauseWhen : "{so_rate} > 0.9 || ( {b_rate} == 0 && {views} > 600 )", 
  maxBid : 5, 
  minBid : 0.1, 
  keywords : [   
    {
      matchType : 'exact',
      seed : '{name}',
    },
    {
      matchType : 'broadMatchModifier',
      seed : '{name}',
      combineList : 'parent',
    },
    {
      matchType : 'broadMatchModifier',
      seed : '{name}',
      combineList : 'generic',
    } 
  ],
  keywordSplitter : /[&\/,]+/,
  pause: true,
  ads : [
    { 
      headlinePart1 : '{name}', 
      headlinePart2 : 'text here',
      description : 'description',
      finalUrl : '{link}',
      path1 : '{parent}',
      path2 : '{id}'
    }
  ]
};

var keywordLists = { 
  parent : [ "{parent}" ],
  generic : [ "matkat", "lomat", "lomamatkat" ]
};

var campaigns = [
  { 
    pause: true,
    budget : 20,
    name : "Bulgaria", 
    includeSelector : { id: "Bulgaria", category_path : /bulgaria/gi },
  },
  { 
    pause: true,
    budget : 20,
    name : "Malediivit", 
    includeSelector : { id: "Malediivit" },
  },
];

existingCampaigns = {};
newCampaigns = {};

function readNewCampaignStructure(callback) {
  
  try {
    var json = fetchFeed(config.source);
  }
  catch(err) {
    
    MyLogger.log('ALERT', "Unable to read feed (errorMsg: " + err.message + ")"); 
    if(!debug) {
      MyLogger.send("alert");
    }
    return;
  }

  // loop trough campaigns
  for(var i = 0; i < campaigns.length; i++) {
    
    var campaign = campaigns[i];
    
    campaign.name = config.campaignPrefix + campaign.name
    
    // set status
    var status = (config.pause) ? 'PAUSED' : 'ENABLED';
    status = (typeof campaign.pause !== 'undefined') ? (campaign.pause) ? 'PAUSED' : 'ENABLED' : status;
    
    // set budget 
    var budget = (typeof campaign.budget !== "undefined") ? parseInt(campaign.budget) : parseInt( config.budget);
    
    // campaign
    newCampaigns[ campaign.name ] = {
      name : campaign.name,
      budget : budget,
      status : status,
      adGroups : {}
    };
    
    // loop through feed objects
    for(var k = 0; k < json.length; k++) {
      var item = json[k]; 

      if( matchSelector(item, campaign.includeSelector) ) {
         if( !matchSelector(item, campaign.excludeSelector ) ) {
         
           // build name for AdGroup 
           var adGroupName = (typeof campaign.adGroupName !== 'undefined' ) ? nano( campaign.adGroupName, item) : nano( config.adGroupName, item);
           
           if(!adGroupName) {
             MyLogger.log('ERR', 'No adgroup name found for item (configuration for "adGroupName" is invalid');
             continue;
           }
           
           
           // start-stop rules
           var pauseWhen = (typeof campaign.pauseWhen !== 'undefined') ? campaign.pauseWhen : config.pauseWhen;
           if( pauseWhen ) {
             pauseWhen = nano(pauseWhen, item);
             try { 
               if( eval(pauseWhen) ) {
                 MyLogger.log('INFO', 'Pause-rule triggered for adgroup ' + adGroupName + ' (campaign: ' + campaign.name + ')');
                 continue;
               
               }
             }
             catch(err) {
               MyLogger.log('ERR', 'Pause-rule error: ' + err.message + ' rule: ' + pauseWhen);
             }
               

             
           }
           
           // build bid
           var bidFormula = (typeof campaign.bidFormula !== 'undefined') ? campaign.bidFormula : config.bidFormula;
           bidFormula = nano(bidFormula, item);
           try {
             var bid = eval(bidFormula);
           }
           catch(err) {
             var bid;
             MyLogger.log('ERR', 'Bid formula error: ' + err.message + ' formula: ' + bidFormula);
           }
           bid = (typeof bid === 'number') ? bid : (typeof campaign.defaultBid === 'number') ? campaign.defaultBid : config.defaultBid;
           
           var maxBid = campaign.maxBid || config.maxBid || 10;
           var minBid = campaign.minBid || config.minBid || 0;
           bid = Math.max( Math.min( bid, maxBid), minBid );
           bid = Math.round(bid * 100) / 100;
           
           if( bid == 0) {
             MyLogger.log('INFO', 'Current configuration results in zero bid for ' + adGroupName + ' (campaign: ' + campaign.name + ')');
             continue;
           }
             
           newCampaigns[ campaign.name ].adGroups[ adGroupName ] = {
             name : adGroupName,
             bid : bid,
             keywords : [],
             ads : [],
           };
           
           // build ads
           
           var ads = [];
           var ads_t = (typeof campaign.ads !== 'undefined') ? campaign.ads : config.ads;
           if(ads_t) {
             for(n in ads_t) {
               ads[n] = {
                 headlinePart1 : nano(ads_t[n].headlinePart1, item),
                 headlinePart2 :  nano(ads_t[n].headlinePart2, item),
                 description :  nano(ads_t[n].description, item),
                 finalUrl :  nano(ads_t[n].finalUrl, item),
                 path1 :  nano(ads_t[n].path1, item),
                 path2 :  nano(ads_t[n].path2, item),
               }
               // execute possible javascript
               for(line in ads[n]) {
                 try {
                   ads[n][line] = eval( ads[n][line] );
                 }
                 catch(e){}
               }
               // ensure we are in character limits
               ads[n] = validateExpandedTextAd(ads[n]);
             }         
           }
          
           // Logger.log( ads );
           newCampaigns[ campaign.name ].adGroups[ adGroupName ].ads = ads;
             
           // build keywords
           var kwTemplate = (typeof campaign.keywords !== 'undefined') ? campaign.keywords : config.keywords;
           newCampaigns[ campaign.name ].adGroups[ adGroupName ].keywords = keywordGenerator( kwTemplate, item);
           
           
         }
      }
    }
  }
  callback();
}

function readExistingCampaignStructure(callback) {
  
 var campaignIterator = AdWordsApp.campaigns().withCondition('Name STARTS_WITH "' + config.campaignPrefix + '"').get();
  while (campaignIterator.hasNext()) {
    var campaign = campaignIterator.next();
    existingCampaigns[ campaign.getName() ] = { 
      obj : campaign, 
      name : campaign.getName(),
      budget : campaign.getBudget(),
      adGroups : {} 
    };
    
    var adGroupIterator = AdWordsApp.adGroups()
    .withCondition("CampaignName = \"" + campaign.getName() + "\"").get();
    
    while (adGroupIterator.hasNext()) {
      var adGroup = adGroupIterator.next();
      existingCampaigns[ campaign.getName() ].adGroups[ adGroup.getName() ] = { 
        obj : adGroup, 
        name : adGroup.getName(),
        bid : adGroup.bidding().getCpc(),
        keywords : [],
        ads : []
      };
      
      var adIterator = adGroup.ads().get();
      while (adIterator.hasNext()) {
        var ad = adIterator.next();
        existingCampaigns[ campaign.getName() ].adGroups[ adGroup.getName() ].ads.push( {
          headlinePart1 : ad.getHeadlinePart1(),
          headlinePart2 : ad.getHeadlinePart2(),
          description : ad.getDescription(),
          finalUrl : ad.urls().getFinalUrl(),
          path1 : ad.getPath1(),
          path2 : ad.getPath2()
        });
   
      }      
     
      var keywordIterator = adGroup.keywords().get();
      while (keywordIterator.hasNext()) {
        var keyword = keywordIterator.next();
        existingCampaigns[ campaign.getName() ].adGroups[ adGroup.getName() ].keywords.push( keyword.getText() );
      }
      
    }
  }
  callback();
}


function processCampaigns() {
  
  // remove non-existing 
  for(var campaignName in existingCampaigns) {

    // campaigns
    if( !newCampaigns.hasOwnProperty(campaignName)) {
      createOrUpdateCampaigns(campaignName, null, "REMOVED" );
      MyLogger.log('REMOVE_CAMPAIGN', campaignName);
      continue;
    }
    
    for(var adGroupName in existingCampaigns[campaignName].adGroups) {     
    
      // pause non-existent adgroups
      if( !newCampaigns[campaignName].adGroups.hasOwnProperty(adGroupName) ) {
        if( existingCampaigns[campaignName].adGroups[adGroupName].obj.isEnabled() ) {
          existingCampaigns[campaignName].adGroups[adGroupName].obj.pause();
          MyLogger.log('PAUSE_ADGROUP', adGroupName); 
        }
        continue;
      }

      // loop through ads 
      for(var n in existingCampaigns[campaignName].adGroups[adGroupName].ads) {
        var ad = existingCampaigns[campaignName].adGroups[adGroupName].ads[n];
        
                   
        if( JSON.stringify( newCampaigns[campaignName].adGroups[adGroupName].ads ).indexOf( JSON.stringify(ad) ) == -1 ) {
          existingCampaigns[campaignName].adGroups[adGroupName].obj.ads()
          .withCondition('HeadlinePart1 = "' + ad.headlinePart1 + '"')
          .withCondition('HeadlinePart2 = "' + ad.headlinePart2 + '"')
          .withCondition('Description = "' + ad.description + '"')
          .withCondition('CreativeFinalUrls = "' + ad.finalUrl + '"')
          .withCondition('Path1 = "' + ad.path1 + '"')
          .withCondition('Path2 = "' + ad.path2 + '"')
          .get().next().remove();
          
          MyLogger.log('REMOVE_AD', ad.headlinePart1 + '(adgroup + ' + adGroupName + ')');
        }
      }
      // loop through keywords 
      for(var n in existingCampaigns[campaignName].adGroups[adGroupName].keywords) {
        var keyword = existingCampaigns[campaignName].adGroups[adGroupName].keywords[n];
        
        if( newCampaigns[campaignName].adGroups[adGroupName].keywords.indexOf( keyword ) === -1 ) {
          existingCampaigns[campaignName].adGroups[adGroupName].obj.keywords().withCondition("Text = \"" + keyword + "\"").get().next().remove(); 
          MyLogger.log('REMOVE_KEYWORD', keyword);
        } 
      }
    }
  }


  // create new campaigns
  for(var campaignName in newCampaigns) {    
   
    if( typeof existingCampaigns[campaignName] === 'undefined' ) {
      
      

      createOrUpdateCampaigns(campaignName, newCampaigns[campaignName].budget, newCampaigns[campaignName].status);
      // we need to wait for the campaign to be created, does not work in preview mode
      var counter = 0;
      var skip = false;
      while(AdWordsApp.campaigns().withCondition('Name = "' + campaignName + '"').get().totalNumEntities() === 0) {
    
        counter = counter + 1;
  
        if(counter > 50) {
          skip = true;
          break;
        }
      }
      if(skip) {
        MyLogger.log('ERR', 'Unable to create campaign ' + campaignName + '. It took too long to create. (Or in preview mode)');
        
        delete newCampaigns[campaignName];
        
        continue;
      }
      var createdCampaign = AdWordsApp.campaigns().withCondition('Name = "' + campaignName + '"').get().next();
      
      MyLogger.log('NEW_CAMPAIGN', campaignName);
      existingCampaigns[campaignName] = {
        obj : createdCampaign, 
        name : createdCampaign.getName(),
        budget : createdCampaign.getBudget(),
        adGroups : {} 
      };
    }
    else {
      
      if( existingCampaigns[campaignName].obj.isPaused() && newCampaigns[campaignName].status == 'ENABLED' ) {
        existingCampaigns[campaignName].obj.enable();
        MyLogger.log('INFO', 'Enable campaign ' + campaignName );
      }
      else if( existingCampaigns[campaignName].obj.isEnabled() && newCampaigns[campaignName].status == 'PAUSED' ) {
        existingCampaigns[campaignName].obj.pause();
        MyLogger.log('INFO', 'Pause campaign ' + campaignName );
        
      } 
      if( existingCampaigns[campaignName].budget != newCampaigns[campaignName].budget ) {
        createOrUpdateCampaigns(campaignName, newCampaigns[campaignName].budget, newCampaigns[campaignName].status );
        MyLogger.log('INFO', 'Update campaign ' + campaignName + ' budget from ' + existingCampaigns[campaignName].budget + ' to ' + newCampaigns[campaignName].budget); 
      }  
    }
  }
  
  // create new adgroups
  var newAdGroupOps = [];
  var newAdGroups = [];
  for(var campaignName in newCampaigns) {
    
    for( var adGroupName in newCampaigns[campaignName].adGroups ) {
      
      var newAdGroup = newCampaigns[campaignName].adGroups[adGroupName];
      var existingAdGroup = (typeof existingCampaigns[campaignName].adGroups[adGroupName] === 'undefined') ? null : existingCampaigns[campaignName].adGroups[adGroupName];
      
      if( existingAdGroup ) {
        if( existingAdGroup.obj.isPaused() ) {
          existingAdGroup.obj.enable();
          MyLogger.log('INFO', 'Enable adgroup ' + adGroupName + ' (campaign: ' + campaignName +')' );
        }
      }
      
      if( !existingAdGroup ) { 
        
        // Logger.log( 'create new adgroup ' + adGroupName );
        newAdGroupOps.push(
          existingCampaigns[campaignName].obj.newAdGroupBuilder()
          .withName( adGroupName )
          .withStatus( "ENABLED" )
          .withCpc( newAdGroup.bid )
          .build()
        );     
        
      }
      else if( newAdGroup.bid != existingAdGroup.bid ) {      
        existingAdGroup.obj.bidding().setCpc( newAdGroup.bid );
        MyLogger.log('INFO', 'Update bid for adgroup ' + adGroupName + ' from ' + existingAdGroup.bid +' to ' + newAdGroup.bid);
      }
    }
  }
  
  for( var i = 0; i < newAdGroupOps.length; i++) {
    if (newAdGroupOps[i].isSuccessful()) {
      var adGroup = newAdGroupOps[i].getResult();
      MyLogger.log('NEW_ADGROUP', adGroup.getName() + ' (campaign :' + adGroup.getCampaign().getName() + ')');
      existingCampaigns[adGroup.getCampaign().getName()].adGroups[adGroup.getName()] = {
        obj : adGroup,
        name : adGroup.getName(),
        bid : adGroup.bidding().getCpc(),
        keywords : [],
        ads : []
      };
    } else {
      // Handle the errors.
      MyLogger.log('ERR', newAdGroups + ' error: ' + newAdGroupOps[i].getErrors() );

    }
  }

  // create new ads
  var newAdOps = [];
  var newAds = [];
  for(var campaignName in newCampaigns) {
    for( var adGroupName in newCampaigns[campaignName].adGroups ) {  

      var newAdGroup = newCampaigns[campaignName].adGroups[adGroupName];
      var existingAdGroup = existingCampaigns[campaignName].adGroups[adGroupName];
      
      for( var i in newAdGroup.ads ) {
        
        var ad = newAdGroup.ads[i];
        
        if( JSON.stringify( existingAdGroup.ads ).indexOf( JSON.stringify(ad) ) == -1 ) {

          newAdOps.push(
            existingAdGroup.obj.newAd().expandedTextAdBuilder()
            .withHeadlinePart1(ad.headlinePart1)
            .withHeadlinePart2(ad.headlinePart2)
            .withDescription(ad.description)
            .withPath1(ad.path1)
            .withPath2(ad.path2)
            .withFinalUrl(ad.finalUrl)
            .build()
          );
          
          newAds.push(ad);
          
        } 
        

      }
      
    }
  }
  
  for( var i = 0; i < newAdOps.length; i++) {
    
    if (newAdOps[i].isSuccessful()) {
      var ad = newAdOps[i].getResult();
      
      MyLogger.log('NEW_AD', ad.getHeadlinePart1() + ' (adgroup: ' + ad.getAdGroup().getName() + ')');

    } else {
      // Handle the errors.
      MyLogger.log('ERR', newAds[i].headlinePart1 + ' error:' + newAdOps[i].getErrors());
      


    }
  } 
  
  // create new keywords
  var newKeywordOps = [];
  var newKeywords = [];
  for(var campaignName in newCampaigns) {
    for( var adGroupName in newCampaigns[campaignName].adGroups ) {
      
      var newAdGroup = newCampaigns[campaignName].adGroups[adGroupName];
      var existingAdGroup = existingCampaigns[campaignName].adGroups[adGroupName];
      
      for( var i in newAdGroup.keywords ) {
        
        var keyword = newAdGroup.keywords[i];
        
        if( existingAdGroup.keywords.indexOf(keyword) === -1 ) {
          newKeywordOps.push(
            existingAdGroup.obj.newKeywordBuilder()
            .withText(keyword)
            .build()
          );
          newKeywords.push(keyword);
        } 

      }
    }
  }

  for( var i = 0; i < newKeywordOps.length; i++) {
    
    if (newKeywordOps[i].isSuccessful()) {
      var keyword = newKeywordOps[i].getResult();
      
      MyLogger.log('NEW_KEYWORD', keyword.getText() + ' (adgroup: ' + keyword.getAdGroup().getName() + ')');

    } else {
      // Handle the errors.
      MyLogger.log('ERR', newKeywords[i] + ' error: ' + newKeywordOps[i].getErrors())

    }
  } 
  
 
}
function fetchFeed(url) {

  var json = UrlFetchApp.fetch(url);
  json = JSON.parse(json);
  Logger.log( json.length + ' items returned from API');
  return json;
  
}
/*
* AdWords Scripts does not support campaign creation directly, using bulk upload functionality
* See https://developers.google.com/adwords/scripts/docs/features/bulk-upload
*/
function createOrUpdateCampaigns(name, budget, status, callback) {
  
  var columns = ['Campaign', 'Budget', 'Bid Strategy type', 'Campaign type', 'Campaign status'];
  
  var upload = AdWordsApp.bulkUploads().newCsvUpload( columns, {moneyInMicros: false});
  
  var status = status || "ENABLED";
  upload.append({
    'Campaign': name,
    'Budget': budget,
    'Bid Strategy type': 'cpc',
    'Campaign type': 'Search Only',
    'Campaign status': status
  });
  // Use upload.apply() to make changes without previewing.
  // upload.preview();
  upload.apply();

}

function matchSelector (item, selector) {
  for( var key in selector ) {
    if( item.hasOwnProperty(key) ) {
      var patt = new RegExp(selector[key]);
      if( patt.test(item[key]) ) {
        return true;
      }
    }
  }
  return false;
};
/* Nano Templates - https://github.com/trix/nano */
function nano(template, data) {
  return template.replace(/\{([\w\.]*)\}/g, function(str, key) {
    var keys = key.split("."), v = data[keys.shift()];
    for (var i = 0, l = keys.length; i < l; i++) v = v[keys[i]];
    return (typeof v !== "undefined" && v !== null) ? v : "";
  });
}
var stats = {
  ALERT : [],
  ERR : [],
  WARN : [],
  INFO : [],
  NEW_ADGROUP : [],
  PAUSE_ADGROUP : [],
  NEW_AD : [],
  REMOVE_AD : [],
  NEW_KEYWORD : [],
  REMOVE_KEYWORD : [],
  NEW_CAMPAIGN : [],
  REMOVE_CAMPAIGN : []
};  
var MyLogger = {
  log : function(type, msg) {   
    Logger.log('[' + type +'] ' + msg);
    stats[type].push(msg);
  },
  send : function(topic) {
    
    var msg = '';
    for( key in stats) {
      msg += '<ul>';
      for(line in stats[key]) {
        var color = "#333";
        if(key == 'ERR' || key == 'ALERT') {
          color = "red";
        }
        msg += '<li><span style="color:'+color+'">[' + key + ']</span> ' + stats[key][line] + "</li>";  
      }
      msg += '</ul>';
    }
    
 
     MailApp.sendEmail( {
       to : emailRecipient,
       subject : AdWordsApp.currentAccount().getName() + ': ' + scriptName + ' ' + topic,
       htmlBody : msg
     } );
    
  }
};
function validateExpandedTextAd(ad) {
  var removeUntil = function(count, string) {
    while( string.length > count ) {
   
      // remove last word
      var lastSpace = string.lastIndexOf(" ");
      if( lastSpace == -1 ) {
        return string.substring(0, count);
        break;
      }
      
      string = string.substring(0, lastSpace);
    }
    return string;
    
  }
  // execute possible javascript
  for(line in ad) {
    switch(line) {
      case 'headlinePart1':
      case 'headlinePart2':
        ad[line] = removeUntil(29, ad[line]);
        break;
      case 'path1':
      case 'path2':
        ad[line] = removeUntil(14, ad[line]);
        break;
      case 'description':
        ad[line] = removeUntil(79, ad[line]);
        break;
    }
  }
  return ad;
     
}
function keywordGenerator(templates, item) {
  var keywordFormat = function(matchType, keyword) {
    var matchTypesAllowed = [ 'broad', 'broadMatchModifier', 'exact', 'phrase' ]
    if(!matchType ) {
      matchType = 'broad';
    }
    if( matchTypesAllowed.indexOf( matchType ) == -1 ) {
      MyLogger.log('WARN', 'Invalid matchType "' + matchType + '", using broad');
      matchType = 'broad';
    }
    keyword = keyword.replace(/\s+/g, ' ').trim();
    switch(matchType ) {
      case 'exact':
        kw = '[' + keyword +']';
        break;
      case 'broadMatchModifier':
        kw = '+' + keyword.split(' ').join(' +');
        break;
      case 'phrase':
        kw = '"' + keyword + '"';
        break;
    }
    return kw;
    
  }
  var created = [];
  for( var t in templates) {
    
    var template = templates[t];
  
    var keywordSplitter = (typeof template.keywordSplitter !== 'undefined') ? template.keywordSplitter : ( typeof config.keywordSplitter !== 'undefined' ) ? config.keywordSplitter : ',';
    var seeds = nano(template.seed, item);
    seeds = seeds.split(keywordSplitter);
    
    if( template.exclude ) {
      var excludePattern = new RegExp(template.exclude);   
    }
    var combineAfter = (typeof template.combineAfter !== 'undefined') ? template.combineAfter : true;
    var combineBefore = (typeof template.combineBefore !== 'undefined') ? template.combineBefore : false;
     
    for(var i in seeds ) {
      if( !template.combineList ) {
        var kw = keywordFormat(template.matchType, seeds[i] );
        if( template.exclude ) {
          if ( !excludePattern.test(kw) ) {
            created.push( kw );
          }
        }
        else {
          created.push( kw );
        }
      }
      else {  
        for( var j in keywordLists[template.combineList] ) {
          if( !keywordLists[template.combineList][j] ) {
            break; 
          }
          var mergeKws = nano( keywordLists[template.combineList][j], item).split(keywordSplitter);
          if( !mergeKws || mergeKws.length == 0) {
            break;
          }
          for( var k in mergeKws) {
            if( combineAfter ) {
              var kw = keywordFormat(template.matchType, seeds[i] + ' ' + mergeKws[k] );
              if( template.exclude ) {
                if( !excludePattern.test(kw) ) {
                  
                  created.push( kw );
                }
              }
              else {
                created.push( kw );
              }
            }
            if( combineBefore ) {
              var kw = keywordFormat(template.matchType, mergeKws[k] + ' ' +  seeds[i] );
              if( template.exclude ) {
                if( !excludePattern.test(kw) ) {
                  created.push( kw );
                }
              }
              else {
                created.push( kw );
              }

            }

          }
          
        }
      }
      
    }
  }
  
  return created;
  
  
}
function main() {
  readExistingCampaignStructure(function() {

    readNewCampaignStructure(function() {
      processCampaigns();
      
      if(!debug) {
        if( 
          stats.ALERT.length > 0 ||
          stats.ERR.length > 0 ||
          stats.NEW_ADGROUP.length > 0 ||
          stats.PAUSE_ADGROUP.length > 0 ) 
        {
          MyLogger.send("summary");
        }
      }
    });
 
  });
}
