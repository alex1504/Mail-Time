var JoSk  = require('josk');
var NoOp  = function noop() {};
var merge = require('deepmerge');

var equals;
equals = function (a, b) {
  var i;
  if (a === b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  if (!(typeof a === 'object' && typeof b === 'object')) {
    return false;
  }

  if (a instanceof Date && b instanceof Date) {
    return a.valueOf() === b.valueOf();
  }

  if (a instanceof Array) {
    if (!(b instanceof Array)) {
      return false;
    }

    if (a.length !== b.length) {
      return false;
    }

    var _a = a.slice();
    var _b = b.slice();
    var j;
    for (i = _a.length - 1; i >= 0; i--) {
      var result = false;
      for (j = _b.length - 1; j >= 0; j--) {
        if (equals(_a[i], _b[j])) {
          result = true;
          _a.splice(i, 1);
          _b.splice(j, 1);
          break;
        }
      }

      if (!result) {
        return false;
      }
    }
    return true;
  }

  i = 0;
  if (typeof a === 'object' && typeof b === 'object') {
    var akeys = Object.keys(a);
    var bkeys = Object.keys(b);

    if (akeys.length !== bkeys.length) {
      return false;
    }

    for (i = akeys.length - 1; i >= 0; i--) {
      if (!hasOwnProperty.call(b, akeys[i])) {
        return  false;
      }

      if (!equals(a[akeys[i]], b[akeys[i]])) {
        return false;
      }
    }

    return true;
  }
  return false;
};

module.exports = (function () {
  function MailTime(opts) {
    if (!opts || typeof opts !== 'object') {
      throw new TypeError('[mail-time] Configuration object must be passed into MailTime constructor');
    }

    if (!opts.db) {
      throw new Error('[mail-time] MongoDB database {db} option is required, like returned from `MongoClient.connect`');
    }

    this.callbacks   = {};
    this.type        = (!opts.type || (opts.type !== 'client' && opts.type !== 'server')) ? 'server' : opts.type;
    this.debug       = (opts.debug !== true) ? false : true;
    this.prefix      = opts.prefix || '';
    this.maxTries    = ((opts.maxTries && !isNaN(opts.maxTries)) ? parseInt(opts.maxTries) : 60) + 1;
    this.interval    = ((opts.interval && !isNaN(opts.interval)) ? parseInt(opts.interval) : 60) * 1000;
    this.template    = (typeof opts.template === 'string') ? opts.template : '{{{html}}}';

    if (this.interval < 2048) {
      this.interval  = 3072;
    }

    this.strategy    = (opts.strategy === 'backup' || opts.strategy === 'balancer') ? opts.strategy : 'backup';
    this.failsToNext = (opts.failsToNext && !isNaN(opts.failsToNext)) ? parseInt(opts.failsToNext) : 4;
    this.transports  = opts.transports || [];
    this.transport   = 0;
    this.from        = (!opts.from || !opts.from.call || !opts.from.apply) ? false : opts.from;

    this.concatEmails     = (opts.concatEmails !== true) ? false : true;
    this.concatSubject    = (opts.concatSubject && typeof opts.concatSubject === 'string') ? opts.concatSubject : 'Multiple notifications';
    this.concatDelimiter  = (opts.concatDelimiter && typeof opts.concatDelimiter === 'string') ? opts.concatDelimiter : '<hr>';
    this.concatThrottling = ((opts.concatThrottling && !isNaN(opts.concatThrottling)) ? parseInt(opts.concatThrottling) : 60)  * 1000;

    if (this.concatThrottling < 2048) {
      this.concatThrottling = 3072;
    }

    if (opts.type === 'server' && (this.transports.constructor !== Array || !this.transports.length)) {
      throw new Error('[mail-time] transports is required and must be an Array, like returned from `nodemailer.createTransport`');
    }

    this.collection = opts.db.collection('__mailTimeQueue__' + this.prefix);
    this.collection.ensureIndex({to: 1, isSent: 1});
    this.collection.ensureIndex({sendAt: 1, isSent: 1, tries: 1}, {background: true});
    // Schema:
    // _id
    // to          {String|[String]}
    // tries       {Number}  - qty of send attempts
    // sendAt      {Date}    - When letter should be sent
    // isSent      {Boolean} - Email status
    // template    {String}  - Template for this email
    // transport   {Number}  - Last used transport
    // concatSubject {String|Boolean} - Email concatenation subject
    // ---
    // mailOptions         {[Object]}  - Array of nodeMailer's `mailOptions`
    // mailOptions.to      {String|Array} - [REQUIRED]
    // mailOptions.from    {String}
    // mailOptions.text    {String|Boolean}
    // mailOptions.html    (String)
    // mailOptions.subject {String}
    // mailOptions.Other nodeMailer `sendMail` options...

    if (this.type === 'server') {
      this.scheduler = new JoSk({
        db: opts.db,
        prefix: 'mailTimeQueue' + this.prefix,
        resetOnInit: false,
        zombieTime: 8192
      });

      this.scheduler.setInterval(this.___send.bind(this), 256, 'mailTimeQueue' + this.prefix);
    }
  }

  MailTime.Template = '<!DOCTYPE html><html xmlns=http://www.w3.org/1999/xhtml><meta content="text/html; charset=utf-8"http-equiv=Content-Type><meta content="width=device-width,initial-scale=1"name=viewport><title>{{subject}}</title><style>body{-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:none;font-family:Tiempos,Georgia,Times,serif;font-weight:400;width:100%;height:100%;background:#fff;font-size:15px;color:#000;line-height:1.5}a{text-decoration:underline;border:0;color:#000;outline:0;color:inherit}a:hover{text-decoration:none}a[href^=sms],a[href^=tel]{text-decoration:none;color:#000;cursor:default}a img{border:none;text-decoration:none}td{font-family:Tiempos,Georgia,Times,serif;font-weight:400}hr{height:1px;border:none;width:100%;margin:0;margin-top:25px;margin-bottom:25px;background-color:#ECECEC}h1,h2,h3,h4,h5,h6{font-family:HelveticaNeue,"Helvetica Neue",Helvetica,Arial,sans-serif;font-weight:300;line-height:normal;margin-top:35px;margin-bottom:4px;margin-left:0;margin-right:0}h1{margin:23px 15px;font-size:25px}h2{margin-top:15px;font-size:21px}h3{font-weight:400;font-size:19px;border-bottom:1px solid #ECECEC}h4{font-weight:400;font-size:18px}h5{font-weight:400;font-size:17px}h6{font-weight:600;font-size:16px}h1 a,h2 a,h3 a,h4 a,h5 a,h6 a{text-decoration:none}pre{font-family:Consolas,Menlo,Monaco,Lucida Console,Liberation Mono,DejaVu Sans Mono,Bitstream Vera Sans Mono,Courier New,monospace,sans-serif;display:block;font-size:13px;padding:9.5px;margin:0 0 10px;line-height:1.42;color:#333;word-break:break-all;word-wrap:break-word;background-color:#f5f5f5;border:1px solid #ccc;border-radius:4px;text-align:left!important;max-width:100%;white-space:pre-wrap;width:auto;overflow:auto}code{font-size:13px;font-family:font-family: Consolas,Menlo,Monaco,Lucida Console,Liberation Mono,DejaVu Sans Mono,Bitstream Vera Sans Mono,Courier New,monospace,sans-serif;border:1px solid rgba(0,0,0,.223);border-radius:2px;padding:1px 2px;word-break:break-all;word-wrap:break-word}pre code{padding:0;font-size:inherit;color:inherit;white-space:pre-wrap;background-color:transparent;border:none;border-radius:0;word-break:break-all;word-wrap:break-word}td{text-align:center}table{border-collapse:collapse!important}.force-full-width{width:100%!important}</style><style media=screen>@media screen{h1,h2,h3,h4,h5,h6{font-family:\'Helvetica Neue\',Arial,sans-serif!important}td{font-family:Tiempos,Georgia,Times,serif!important}code,pre{font-family:Consolas,Menlo,Monaco,\'Lucida Console\',\'Liberation Mono\',\'DejaVu Sans Mono\',\'Bitstream Vera Sans Mono\',\'Courier New\',monospace,sans-serif!important}}</style><style media="only screen and (max-width:480px)">@media only screen and (max-width:480px){table[class=w320]{width:100%!important}}</style><body bgcolor=#FFFFFF class=body style=padding:0;margin:0;display:block;background:#fff;-webkit-text-size-adjust:none><table cellpadding=0 cellspacing=0 width=100% align=center><tr><td align=center valign=top bgcolor=#FFFFFF width=100%><center><table cellpadding=0 cellspacing=0 width=600 style="margin:0 auto"class=w320><tr><td align=center valign=top><table cellpadding=0 cellspacing=0 width=100% style="margin:0 auto;border-bottom:1px solid #ddd"bgcolor=#ECECEC><tr><td><h1>{{{subject}}}</h1></table><table cellpadding=0 cellspacing=0 width=100% style="margin:0 auto"bgcolor=#F2F2F2><tr><td><center><table cellpadding=0 cellspacing=0 width=100% style="margin:0 auto"><tr><td align=left style="text-align:left;padding:30px 25px">{{{html}}}</table></center></table></table></center></table>';

  /*
   @memberOf MailTime
   @name ___send
   @param ready {Function} - See JoSk NPM package
   @returns {void}
   */
  MailTime.prototype.___send = function (ready) {
    var self = this;
    this.collection.findOneAndUpdate({
      $or: [{
        isSent: false,
        sendAt: {
          $lte: new Date()
        },
        tries: {
          $lt: this.maxTries
        }
      }, {
        isSent: true,
        sendAt: {
          $lt: new Date(+new Date() - (this.interval * 4))
        },
        tries: {
          $lt: this.maxTries
        }
      }]
    }, {
      $set: {
        isSent: true,
        sendAt: new Date(+new Date() + self.interval)
      },
      $inc: {
        tries: 1
      }
    }, {
      returnOriginal: false,
      projection: {
        _id: 1,
        tries: 1,
        template: 1,
        transport: 1,
        mailOptions: 1,
        concatSubject: 1
      }
    }, function (findUpdateError, result) {
      process.nextTick(function () {
        ready();
      });

      var task = (typeof result === 'object') ? result.value : null;
      if (findUpdateError) {
        self.___handleError(task, findUpdateError);
        return;
      }

      if (!task) {
        return;
      }

      process.nextTick(function () {
        var transport;
        if (self.strategy === 'balancer') {
          self.transport = self.transport + 1;
          if (self.transport >= self.transports.length) {
            self.transport = 0;
          }
          transport = self.transports[self.transport];
        } else {
          transport = self.transports[task.transport];
        }

        try {
          var _mailOpts;

          if (task.mailOptions.length === 1) {
            _mailOpts = task.mailOptions[0];
          } else {
            _mailOpts = task.mailOptions[0];
            for (var i = 1; i < task.mailOptions.length; i++) {
              if (task.mailOptions[i].html) {
                task.mailOptions[i].html = self.___render(task.mailOptions[i].html, task.mailOptions[i]);
                if (task.template || self.template) {
                  _mailOpts.html += self.concatDelimiter + self.___render((task.template || self.template), task.mailOptions[i]);
                } else {
                  _mailOpts.html += self.concatDelimiter + task.mailOptions[i].html;
                }
                delete task.mailOptions[i].html;
              }

              if (task.mailOptions[i].text) {
                _mailOpts.text += '\r\n' + self.___render(task.mailOptions[i].text, task.mailOptions[i]);
                delete task.mailOptions[i].text;
              }

              _mailOpts = merge(_mailOpts, task.mailOptions[i]);
            }

            _mailOpts.subject = task.concatSubject || self.concatSubject || _mailOpts.subject;
          }

          if (_mailOpts.html && (task.template || self.template)) {
            _mailOpts.html = self.___render((task.template || self.template), _mailOpts);
          }

          if (!_mailOpts.from && self.from) {
            _mailOpts.from = self.from(transport);
          }

          if (self.debug === true) {
            console.info('[mail-time] Send attempt #' + (task.tries) + ', transport #' + task.transport + '/' + self.transport + ', to: ', task.mailOptions[0].to, 'from: ', _mailOpts.from);
          }

          transport.sendMail(_mailOpts, function (error, info) {
            if (error) {
              self.___handleError(task, error);
              return;
            }

            self.collection.deleteOne({
              _id: task._id
            }, function () {
              if (self.debug === true) {
                console.info('[mail-time] email successfully sent, attempts: #' + (task.tries) + ', transport #' + task.transport + '/' + self.transport + ' to: ', _mailOpts.to);
              }

              var _id = task._id.toHexString();
              if (self.callbacks[_id] && self.callbacks[_id].length) {
                self.callbacks[_id].forEach(function (cb, index) {
                  cb(void 0, info, task.mailOptions[index]);
                });
              }
              delete self.callbacks[_id];
            });

            return;
          });
        } catch (e) {
          if (self.debug === true) {
            console.error('[mail-time] Exception during runtime:', e);
          }
          self.___handleError(task, e);
        }
      });

      return;
    });
  };

  /*
   @memberOf MailTime
   @name send
   @description alias of `sendMail`
   @returns {void}
   */
  MailTime.prototype.send = function (opts, callback) {
    this.sendMail(opts, callback);
  };

  /*
   @memberOf MailTime
   @name sendMail
   @param opts          {Object}   - Letter options with next properties:
   @param opts.sendAt   {Date}     - When email should be sent
   @param opts.template {String}   - Template string
   @param opts[key]     {mix}      - Other MailOptions according to NodeMailer lib
   @param callback      {Function} - [OPTIONAL] Callback function
   @returns {void}
   */
  MailTime.prototype.sendMail = function (_opts, _callback) {
    var self = this;
    var opts = {};
    var callback = NoOp;

    console.log(_opts.to, _opts.text);

    if (_opts && typeof _opts === 'object') {
      opts = _opts;
    }

    if (_callback && _callback.call && _callback.apply) {
      callback = _callback;
    }

    if (!opts.sendAt || Object.prototype.toString.call(opts.sendAt) !== '[object Date]') {
      opts.sendAt = new Date();
    }

    if (typeof opts.template !== 'string') {
      opts.template = false;
    }

    if (typeof opts.concatSubject !== 'string') {
      opts.concatSubject = false;
    }

    var _sendAt        = opts.sendAt;
    var _template      = opts.template;
    var _concatSubject = opts.concatSubject;
    delete opts.sendAt;
    delete opts.template;
    delete opts.concatSubject;

    if (typeof opts.to !== 'string' && (opts.to !== Array || !opts.to.length)) {
      throw new Error('[mail-time] `mailOptions.to` is required and must be a string or non-empty Array');
    }

    if (this.concatEmails) {
      this.collection.findOne({
        to: opts.to,
        isSent: false
      }, {
        fields: {
          _id: 1,
          mailOptions: 1
        }
      }, function (findError, task) {
        if (findError) {
          if (self.debug === true) {
            console.error('[mail-time] something went wrong, can\'t send email to: ', opts.mailOptions[0].to, findError);
          }
          callback(findError, void 0, task);
          return;
        }

        if (task) {
          var queue = task.mailOptions || [];

          for (var i = 0; i < queue.length; i++) {
            if (equals(queue[i], opts)) {
              return;
            }
          }

          queue.push(opts);

          self.collection.updateOne({
            _id: task._id
          }, {
            $set: {
              mailOptions: queue
            }
          }, function (updateError) {
            if (updateError) {
              if (self.debug === true) {
                console.error('[mail-time] something went wrong, can\'t send email to: ', task.mailOptions[0].to, updateError);
              }
              callback(updateError, void 0, task);
            }
          });

          return;
        }

        _sendAt = new Date(+_sendAt + self.concatThrottling);
        self.___addToQueue({
          sendAt: _sendAt,
          template: _template,
          mailOptions: opts,
          concatSubject: _concatSubject
        }, callback);
        return;
      });

      return;
    }

    this.___addToQueue({
      sendAt: _sendAt,
      template: _template,
      mailOptions: opts,
      concatSubject: _concatSubject
    }, callback);

    return;
  };

  /*
   @memberOf MailTime
   @name ___handleError
   @param task  {Object} - Email task record form Mongo
   @param error {mix}    - Error String/Object/Error
   @returns {void}
   */
  MailTime.prototype.___handleError = function (task, error) {
    if (!task) {
      return;
    }

    if (task.tries > this.maxTries) {
      var self = this;
      this.collection.deleteOne({
        _id: task._id
      }, function () {
        if (self.debug === true) {
          console.error('[mail-time] Giving up trying send email after ' + (task.tries) + ' attempts to: ', task.mailOptions[0].to, error);
        }

        var _id = task._id.toHexString();
        if (self.callbacks[_id] && self.callbacks[_id].length) {
          self.callbacks[_id].forEach(function (cb, i) {
            cb(error, void 0, task.mailOptions[i]);
          });
        }
        delete self.callbacks[_id];
      });
    } else {
      var transport = task.transport;

      if (this.strategy === 'backup' && (task.tries % this.failsToNext) === 0) {
        ++transport;
        if (transport > this.transports.length - 1) {
          transport = 0;
        }
      }

      this.collection.updateOne({
        _id: task._id
      }, {
        $set: {
          isSent: false,
          transport: transport
        }
      }, NoOp);

      if (this.debug === true) {
        console.warn('[mail-time] Re-send Attempt #' + (task.tries) + ', transport #' + transport + '/' + this.transport + ' to: ', task.mailOptions[0].to, error);
      }
    }
  };

  /*
   @memberOf MailTime
   @name ___addToQueue
   @param opts             {Object}   - Letter options with next properties:
   @param opts.sendAt      {Date}     - When email should be sent
   @param opts.mailOptions {Object}   - MailOptions according to NodeMailer lib
   @param callback         {Function} - [OPTIONAL] Callback function
   @returns {void}
   */
  MailTime.prototype.___addToQueue = function (opts, callback) {
    var self = this;
    var task = {
      tries: 0,
      isSent: false,
      sendAt: opts.sendAt,
      template: opts.template,
      transport: this.transport,
      mailOptions: [opts.mailOptions],
      concatSubject: opts.concatSubject
    };

    if (this.concatEmails) {
      task.to = opts.mailOptions.to;
    }

    this.collection.insertOne(task, function (insertError, r) {
      if (insertError) {
        if (self.debug === true) {
          console.error('[mail-time] something went wrong, can\'t send email to: ', opts.mailOptions[0].to, insertError);
        }
        callback(insertError, void 0, opts);
        return;
      }

      var _id = r.insertedId.toHexString();
      if (!self.callbacks[_id]) {
        self.callbacks[_id] = [];
      }
      self.callbacks[_id].push(callback);
      return;
    });
  };

  /*
   @memberOf MailTime
   @name ___render
   @param string       {String} - Template with Spacebars/Blaze/Mustache-like placeholders
   @param replacements {Object} - Blaze/Mustache-like helpers Object
   @returns {String}
   */
  MailTime.prototype.___render = function (_string, replacements) {
    var i;
    var string    = _string;
    var matchHTML = string.match(/\{{3}\s?([a-zA-Z0-9\-\_]+)\s?\}{3}/g);
    var matchStr  = string.match(/\{{2}\s?([a-zA-Z0-9\-\_]+)\s?\}{2}/g);

    if (matchHTML) {
      for (i = 0; i < matchHTML.length; i++) {
        if (replacements[matchHTML[i].replace('{{{', '').replace('}}}', '').trim()]) {
          string = string.replace(matchHTML[i], replacements[matchHTML[i].replace('{{{', '').replace('}}}', '').trim()]);
        }
      }
    }

    if (matchStr) {
      for (i = 0; i < matchStr.length; i++) {
        if (replacements[matchStr[i].replace('{{', '').replace('}}', '').trim()]) {
          string = string.replace(matchStr[i], replacements[matchStr[i].replace('{{', '').replace('}}', '').trim()].replace(/<(?:.|\n)*?>/gm, ''));
        }
      }
    }
    return string;
  };

  return MailTime;
})();