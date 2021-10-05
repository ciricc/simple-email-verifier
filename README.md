# Simple Email verification

This class can help you to check that some email is realy exists in the Internet.
For example, if you don't want to send email verification message with code, but just want to check that email wasn't generated by `RANDOM_EMAIL()` function.

## Method

1. First, it's a simple regular expression checking. Verify that email have a normal format.
2. Second, it's looking for [MX records](https://en.wikipedia.org/wiki/MX_record) by DNS resolving.
3. And the last step is checking for account exists in the SMTP server by sending some protocol messages.

## Installation

```shell
npm i simple-email-verifier
```

## Usage

```js
const { EmailVerifier } = require("simple-email-verifier");

let verifier = new EmailVerifier(10000);

verifier.verify("random_email@big.com").then(result => {
  if (result) {
    console.log("This email realy exists!");
  } else {
    console.log("Email not found :(");
  }
}).catch(console.error);
```

## API

* `EmailVerifier(timeout: number, dnsCacheSettings: Object, mailFrom: string)` - Main verifier class, where `mailFrom` - is your random server email, `timeout` - is timeout for email verify in `.verifySmtpRecord()` method. And `dnsCacheSettings` are settings for [dnscache](https://github.com/yahoo/dnscache) package.
* `verifier.verify(email: string): Promise<boolean>` - Full email verify promise.
* `verifier.isValidEmail(email: string): boolean` - Validate email by regular expression.
* `verifier.getEmailDomain(email: string): string` - Get email domain after `@` symbol.
* `verifier.checkMx(email: string): Promise<[]MxRecord>` - Look for MX records by DNS resolve.
* `verifier.verifySmtpRecord(mxRecord: string, email: string): Promise<boolean>` - Check email account existing in the SMTP server.

### Typings

Some types of this module.

#### MxRecord
MX record object

* <b>exchange</b> - Mail Exhange
* <b>priority</b> - Exchange priority