module.exports = function (RED) {
    const request = require('request');
    const fs = require('fs');

    function OAuth2(config) {
        RED.nodes.createNode(this, config);

        this.name = config.name;
        this.simulation_mode = config.simulation_mode;
        this.client_id = this.credentials.client_id;
        this.client_secret = this.credentials.client_secret;

        this.context().flow.set('homeconnect_simulation', this.simulation_mode);

        const auth = {
            tokenHost: {
                simulation: 'https://simulator.home-connect.com',
                production: 'https://api.home-connect.com'
            },
            tokenPath: '/security/oauth/token',
            authorizePath: '/security/oauth/authorize'
        }

        const id = this.id;

        this.status({ fill: 'red', shape: 'ring', text: 'unauthorized' });

        const node = this;

        node.getAuthorizationUrl = (protocol, hostname, port, client_id) => {
            node.status({ fill: 'yellow', shape: 'ring', text: 'authorizing...' });

            let callbackUrl = protocol + '//' + hostname + (port ? ':' + port : '')
                + '/oauth2/auth/callback';

            node.context().set('callback_url', callbackUrl);

            let tokenHost = node.context().flow.get('homeconnect_simulation') ? auth.tokenHost.simulation : auth.tokenHost.production;

            return tokenHost + auth.authorizePath + 
                '?client_id=' + client_id + 
                '&response_type=code&redirect_uri=' + callbackUrl;
        };

        node.getTokens = (authCode) => {
            let n = RED.nodes.getNode(id);
            let tokenHost = node.context().flow.get('homeconnect_simulation') ? auth.tokenHost.simulation : auth.tokenHost.production;
            request.post({
                headers: {'content-type' : 'application/x-www-form-urlencoded'},
                url: tokenHost + auth.tokenPath,
                body: 'client_id=' + n.client_id + 
                    '&client_secret=' + n.client_secret + 
                    '&grant_type=authorization_code&code=' + authCode +
                    '&redirect_uri=' + node.context().get('callback_url')
            }, (error, response, body) => {

                if (error || response.statusCode != 200) {
                    n.status({ fill: 'red', shape:'dot', text: 'getTokens failed' });
                    return;
                }

                n.status({ fill: 'green', shape:'dot', text: 'authorized' });

                n.tokens = { ...JSON.parse(body), timestamp: Date.now() };
                
                fs.writeFile('homeconnect_tokens.json', JSON.stringify(n.tokens), (err) => {
                    if (err) {
                        console.log(err);
                    }
                });

                n.send({
                    topic: 'oauth2',
                    payload: {
                        access_token: n.tokens.access_token
                    }
                });
            });
        }

        node.refreshTokens = () => {
            let n = RED.nodes.getNode(id);
            let tokenHost = node.context().flow.get('homeconnect_simulation') ? auth.tokenHost.simulation : auth.tokenHost.production;
            request.post({
                headers: {'content-type' : 'application/x-www-form-urlencoded'},
                url: tokenHost + auth.tokenPath,
                body: 'grant_type=refresh_token&client_secret=' + n.client_secret + '&refresh_token=' + n.tokens.refresh_token
            }, (error, response, body) => {
                if (error || response.statusCode != 200) {
                    return;
                }

                n.status({ fill: 'green', shape:'dot', text: 'authorized' });

                n.tokens = { ...JSON.parse(body), timestamp: Date.now() };
                
                fs.writeFile('homeconnect_tokens.json', JSON.stringify(n.tokens), (err) => {
                    if (err) {
                        console.log(err);
                    }
                });

                n.send({
                    topic: 'oauth2',
                    payload: {
                        access_token: n.tokens.access_token
                    }
                });
            });
        };

        node.loadTokenFile = () => {
            try {
            let content = fs.readFileSync('homeconnect_tokens.json', 'utf8');
            node.tokens = JSON.parse(content);

            if (node.tokens != undefined) {
                node.refreshTokens();
            }
            } catch (err) {

            }
        };

        RED.events.on("nodes-started", () => {
            node.loadTokenFile();
        });

        RED.httpAdmin.get('/oauth2/auth/callback', (req, res) => {
            let n = RED.nodes.getNode(id);
            n.getTokens(req.query.code);
            res.sendStatus(200);
        });
    }
    RED.nodes.registerType('OAuth2', OAuth2, {
        credentials: {
            client_id: { type: 'text' },
            client_secret: { type: 'text' }
        }
    });

    RED.httpAdmin.get('/oauth2/:id/auth/url', (req, res) => {
        if (!req.query.protocol || !req.query.hostname) {
            res.sendStatus(400);
            return;
        }

        let node = RED.nodes.getNode(req.params.id);
        if (!node) {
            res.sendStatus(404);
            return;
        }

        let client_id = node.client_id;

        const url = node.getAuthorizationUrl(req.query.protocol, req.query.hostname, req.query.port, client_id);
        res.send({
            'url': url
        });
    });
}