var fs = require('fs'),
    SteamUser = require('steam-user'),
    mkdirp = require('mkdirp'),
    path = require('path'),
    async = require('async'),
    SteamTotp = require('steam-totp'),
    listenChat = require('./listenchat.js'),
    enableMobile = require('./enablemobile.js'),
    acceptRequests = require('./acceptrequests.js'),
    keepAlive = require('./keepalive.js').main,
    updateTwoFactorCode = require('./updatetwofactorcode.js'),
    launchTeamspeak = require('./launchteamspeak.js');

exports.launch = function() {

    async.series([
        function(callback) {
            //  Create the data folder if it doesn't already exist.
            try {
                if (!fs.existsSync(path.join(__dirname, '../', "data"))) {
                    console.log("Creating data folder...");
                    mkdirp.sync(path.join(__dirname, '../', "data"));
                    var writeMe = {
                        users: []
                    };
                    fs.writeFileSync(path.join(__dirname, '../', "data/verified.json"), JSON.stringify(writeMe, null, 2), 'utf-8');
                }
                callback(null);
            } catch (err) {
                callback(err)
            }
        },
        function(callback) {
            //  Read config.json and initialize client.

            try {
                var configjson = JSON.parse(fs.readFileSync(path.join(__dirname, '../', "config.json")));
            } catch (err) {
                callback(err);
            }
            callback(null, {
                ts_ip: configjson.main.ts_ip,
                q_port: configjson.main.q_port,
                q_username: configjson.main.q_username,
                q_password: configjson.main.q_password,
                bot_username: configjson.main.bot_username,
                bot_password: configjson.main.bot_password,
                q_vserverid: configjson.main.q_vserverid,
                minlevel: configjson.main.minlevel,
                wantedrankid: configjson.main.wantedrankid,
                editdescription: configjson.main.editdescription,
                twofactor: configjson.twofactor.enabled,
                clanabbreviation: configjson.main.clanabbreviation
            })
        }
    ],
    function(err, results) {
        if (err != null) {
            console.log("Could not read config.json: " + err);
            process.exit();
        }
        var config = results[1];

        async.parallel([
            function (callback) {
                //  Log into Steam.

                var steamClient = new SteamUser();
                if (fs.existsSync(path.join(__dirname, '../', "data/twofactor.json")) && config.twofactor) {
                    var twofactorj = JSON.parse(fs.readFileSync(path.join(__dirname, '../', "data/twofactor.json")));
                    var code = SteamTotp.generateAuthCode(twofactorj.shared_secret);
                    steamClient.logOn({
                        accountName: config.bot_username,
                        password: config.bot_password,
                        twoFactorCode: code
                    })
                } else {
                    steamClient.logOn({
                        accountName: config.bot_username,
                        password: config.bot_password
                    })
                }

                steamClient.once('loggedOn', function () {
                    var pjson = JSON.parse(fs.readFileSync(path.join(__dirname, '../', "package.json")));
                    steamClient.setPersona(1, config.clanabbreviation + " bot (" + pjson.version + ")");
                    callback(null, steamClient);
                });

                steamClient.once('error', function (err) {
                    callback(err);
                })
            },
            function (callback) {
                //  Log into TeamSpeak

                launchTeamspeak(config, callback);
            }
        ],
        function (err, results) {
            //  var config is already in bigger scope.
            //  results = [steamClient, teamspeakClient]

            if (err != null) {
                console.log(err);
                process.exit();
            }
            //  We are now successfully logged into steam.

            var steamClient = results[0];
            var teamspeakClient = results[1];
            console.log("Succesfully launched the bot.");

            //  Check if Steam Guard is enabled and if we need to set it up.
            if (!fs.existsSync(path.join(__dirname, '../', "data/twofactor.json"))) {
                //  Logged in; no Steam Guard enabled.

                if (config.twofactor) {
                    try {
                        enableMobile(steamClient);
                    } catch (err) {
                        console.log("There was an error while enabling Steam Guard: " + err);
                    }
                }
            }
            //  Apply regular logic here after bot is logged into Steam and connected to the TeamSpeak query.

            var teamspeakStatus = true;
            var verified_users = JSON.parse(fs.readFileSync(path.join(__dirname, '../', "data/verified.json")));
            listenChat(config, steamClient, teamspeakClient, verified_users, teamspeakStatus);
            acceptRequests(steamClient, SteamUser);
            keepAlive(teamspeakClient, teamspeakStatus, steamClient, config);
            if (config.twofactor) {
                setInterval(updateTwoFactorCode, 2000);
            }
        })
    })
};