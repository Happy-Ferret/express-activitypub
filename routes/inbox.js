'use strict';
const express = require('express'),
      crypto = require('crypto'),
      request = require('request'),
      router = express.Router();

function signAndSend(message, name, domain, req, res, targetDomain) { 
  // get the private key
  let db = req.app.get('db');
  db.get('select privkey from accounts where name = $name', {$name: `${name}@${domain}`}, (err, result) => {
    if (result === undefined) {
      return res.status(404).send(`No record found for ${name}.`);
    }
    else {
      let privkey = result.privkey;
      const signer = crypto.createSign('sha256');
      let d = new Date();
      let stringToSign = `(request-target): post /inbox\nhost: ${targetDomain}\ndate: ${d.toUTCString()}`;
      signer.update(stringToSign);
      signer.end();
      const signature = signer.sign(privkey);
      const signature_b64 = signature.toString('base64');
      let header = `keyId="https://${domain}/u/${name}",headers="(request-target) host date",signature="${signature_b64}"`;
      request({
        url: `https://${targetDomain}/inbox`,
        headers: {
          'Host': targetDomain,
          'Date': d.toUTCString(),
          'Signature': header
        },
        method: 'POST',
        json: true,
        body: message
      }, function (error, response){
        if (error) {
          console.log('Error:', error, response.body);
        }
        else {
          console.log('Response:', response.body);
        }
      });
      return res.status(200);
    }
  });
}

function sendAcceptMessage(thebody, name, domain, req, res, targetDomain) {
  const guid = crypto.randomBytes(16).toString('hex');
  let message = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    'id': `https://${domain}/${guid}`,
    'type': 'Accept',
    'actor': `https://${domain}/u/${name}`,
    'object': thebody,
  };
  signAndSend(message, name, domain, req, res, targetDomain);
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch(e) {
    return null;
  }
}

router.post('/', function (req, res) {
  // pass in a name for an account, if the account doesn't exist, create it!
  let domain = req.app.get('domain');
  const myURL = new URL(req.body.actor);
  let targetDomain = myURL.hostname;
  // TODO: add "Undo" follow event
  if (typeof req.body.object === 'string' && req.body.type === 'Follow') {
    let name = req.body.object.replace(`https://${domain}/u/`,'');
    sendAcceptMessage(req.body, name, domain, req, res, targetDomain);
    // Add the user to the DB of accounts that follow the account
    let db = req.app.get('db');
    // get the followers JSON for the user
    db.get('select followers from accounts where name = $name', {$name: `${name}@${domain}`}, (err, result) => {
      if (result === undefined) {
        console.log(`No record found for ${name}.`);
      }
      else {
        // update followers
        let followers = parseJSON(result.followers);
        if (followers) {
          followers.push(req.body.actor);
          // unique items
          followers = [...new Set(followers)];
        }
        else {
          followers = [req.body.actor];
        }
        let followersText = JSON.stringify(followers);
        // update into DB
        db.run('update accounts set followers=$followers where name = $name', {$name: `${name}@${domain}`, $followers: followersText}, (err, result) => {
          console.log('updated followers!', err, result);
        });
      }
    });
  }
});

module.exports = router;
