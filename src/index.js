const util = require("util");
const dnscache = require("dnscache");

const net = require("net");
const EventEmitter = require("events");

const CONNECTION_EVENT_CODES = {
  HANDHSKAKE: "handshake",
  HELO_OK: "helo_ok",
  MAIL_FROM_OK: "mailfrom_ok",
  SEND_QUIT: "send_quit",
}

/**
 * @typedef {Object} MxRecord
 * @prop {String} exchange
 * @prop {Number} priority 
 */

/**
 * EmailVerifier verifies email by SMTP protocol messages
 */
class EmailVerifier {
  /**
   * 
   * @param {Number} timeout timeot in looking for SMTP response (ms)
   * @param {Object} dnsCacheSettings require("dnscache") settings
   * @param {String} mailFrom mailfrom string in message 
   */
  constructor(timeout=5000, dnsCacheSettings={}, mailFrom="admin@vkflex.ru") {
    /** @type {Number} */
    this.timeout = timeout;
    this.dnscache = dnscache(dnsCacheSettings);
    /** @type {String} */
    this.mailFrom = mailFrom;
  }

  /**
   * Verifies email address, checks for SMTP user available 
   * @param {String} email
   * @returns {Boolean} Valid or not
   */
  async verify(email) {
    if (!this.isValidEmail(email)) return false;
    let emailDomain = this.getEmailDomain(email);
    let mx = await this.checkMx(emailDomain);
    if (!mx || !mx.length) return false;
    let completeResult = false;
    for (let mxRecord of mx) {
      let res = await this.verifySmtpRecord(mxRecord.exchange, email);
      if (res) {
        completeResult = true;
        break;
      }
    }
    return completeResult;
  }

  /**
   * Checks that email have a valid format
   * @param {String} email
   * @returns {Boolean} 
   */
  isValidEmail(email) {
    return !!email.match(/^(([^<>()\[\]\.,;:\s@\"]+(\.[^<>()\[\]\.,;:\s@\"]+)*)|(\".+\"))@(([^<>()[\]\.,;:\s@\"]+\.)+[^<>()[\]\.,;:\s@\"]{2,})$/i)
  }

  /**
   * Returns email domain name
   * @param {String} email 
   */
  getEmailDomain(email) {
    return email.split("@")[1];
  }

  /**
   * Checks for mx records in DNS
   * @param {String} domain
   * @returns {Array<MxRecord>}
   */
  async checkMx(domain) {
    return util.promisify(this.dnscache.resolveMx)(domain);
  }

  /**
   * Verifies SMTP record by email account 
   * @param {String} mxRecord mx record from dns
   * @param {String} email email address
   * @returns {Boolean} valid or not this email by this record
   */
  async verifySmtpRecord(mxRecord, email) {
    return new Promise((resolve, reject) => {
      let connectionState = {
        handshake: false,
        heloSentOk: false,
        mailFromSentOk: false,
        rcptToSent: false,
        quitSent: false,
        errorMessage: "",
        quitTimeout: null,
        receivedFirstBytes: false,
        log: [],
      }
      
      let connectionEvents = new EventEmitter();

      connectionEvents.on(CONNECTION_EVENT_CODES.HANDHSKAKE, () => {
        connectionState.handshake = true;
        client.write(`HELO ${mxRecord}\r\n`);
      });

      connectionEvents.on(CONNECTION_EVENT_CODES.HELO_OK, () => {  
        connectionState.heloSentOk = true;
        client.write(`MAIL FROM: <${this.mailFrom}>\r\n`)
      });
      
      connectionEvents.on(CONNECTION_EVENT_CODES.MAIL_FROM_OK, () => {
        connectionState.mailFromSentOk = true;
        client.write(`RCPT TO: <${email}>\r\n`);
      });

      const sendQuit = () => {
        if (client.destroyed || connectionState.quitSent || !connectionState.receivedFirstBytes) return;
        connectionState.quitSent = true;
        client.write(`QUIT\r\n`);
      }

      let client = net.createConnection(25, mxRecord);

      let _write = client.write;
      client.write = function (message) {
        connectionState.log.push({
          C: message
        })
        return _write.call(client, message)
      }

      client.setTimeout(this.timeout);

      client.on("timeout", () => {
        connectionState.errorMessage = "Connection timeout expired! (" + this.timeout + "ms)";
        sendQuit();
        if (!connectionState.quitTimeout) {
          connectionState.quitTimeout = setTimeout(() => {
            client.end();
            return reject(new Error(connectionState.errorMessage));
          }, 10000);
        }
      });

      client.on("close", () => {
        clearTimeout(connectionState.quitTimeout);
        if (connectionState.errorMessage) {
          if (connectionState.mailFromSentOk) {
            return resolve(false);
          } else {
            return reject(new Error(connectionState.errorMessage));
          }
        } else {
          return resolve(true);
        }
      });

      client.on("error", (err) => {
        return reject(new Error("Connection error smtp: " + err.message));
      }); 

      client.on("data", (dataBytes) => {
        connectionState.receivedFirstBytes = true;

        let dataString = dataBytes.toString();

        connectionState.log.push({
          S: dataString
        })

        let commands = dataString.split('\r\n').filter(r => r);
        commands = commands.map(command => {
          let cd = command.replace(/([0-9]{3})-?/g, "$1 ").split(" ")
          return {
            code: cd[0].split("").map(r => +r),
            fullCode: +cd[0],
            message: cd.slice(1, cd.length).join(" ")
          }
        });
        
        let error = commands.find(r => {
          return r.code[0] != 2
        });

        if (error) {
          connectionState.errorMessage = error.message;
          if (!connectionState.handshake) {
            return;
          }
          return sendQuit();
        } else {

          if (connectionState.quitSent) {
            return;
          }
          
          if (!connectionState.handshake) { // handhake response got
            if (commands[0].fullCode === 220) {
              return connectionEvents.emit(CONNECTION_EVENT_CODES.HANDHSKAKE);
            } 
          } else if (!connectionState.heloSentOk) {
            if (commands[0].fullCode === 250) {
              return connectionEvents.emit(CONNECTION_EVENT_CODES.HELO_OK);
            }
          } else if (!connectionState.mailFromSentOk) {
            if (commands[0].fullCode === 250) {
              return connectionEvents.emit(CONNECTION_EVENT_CODES.MAIL_FROM_OK);
            }
          } else if (!connectionState.rcptToSent) {
            if (commands[0].fullCode === 250) {
              connectionState.rcptToSent = true;
              return sendQuit();
            }
          }

          connectionState.errorMessage = "Unknow response: " + commands[0].fullCode + "; " + commands[0].message;
          return sendQuit();
        }
      });
    });
  }
}

module.exports = { EmailVerifier }