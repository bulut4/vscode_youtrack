'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const fs = require("fs");
const https = require("https");
const xml2js = require("xml2js");
const pug = require("pug");
const childProcess = require("child_process");
function activate(context) {
    let globalIssues;
    class _git {
        branch(branchName) {
            let bStat = childProcess.exec('git checkout -b "' + branchName + '"', {
                cwd: vscode.workspace.rootPath
            }, (err, stdout, stderr) => {
                if (err) {
                    vscode.window.showErrorMessage('Git create branch error:' + err);
                    return;
                }
                vscode.window.showInformationMessage(stderr);
            });
        }
        currentBranch() {
            return new Promise((resolve, reject) => {
                let bStat = childProcess.exec('git symbolic-ref --short HEAD', {
                    cwd: vscode.workspace.rootPath
                }, (err, stdout, stderr) => {
                    if (err) {
                        reject(err);
                    }
                    else
                        resolve(stdout);
                });
            });
        }
        checkout(branchName) {
            return new Promise((resolve, reject) => {
                let bStat = childProcess.exec('git checkout ' + branchName, {
                    cwd: vscode.workspace.rootPath
                }, (err, stdout, stderr) => {
                    if (err) {
                        vscode.window.showErrorMessage('Git checkout error:' + err);
                        reject(err);
                    }
                    else
                        resolve();
                });
            });
        }
        merge(branchName) {
            return new Promise((resolve, reject) => {
                let bStat = childProcess.exec('git merge ' + branchName, {
                    cwd: vscode.workspace.rootPath
                }, (err, stdout, stderr) => {
                    if (err) {
                        vscode.window.showErrorMessage('Git merge error:' + err);
                        reject(err);
                    }
                    else
                        resolve();
                });
            });
        }
        deleteBranch(branchName) {
            return new Promise((resolve, reject) => {
                let bStat = childProcess.exec('git branch -d "' + branchName + '"', {
                    cwd: vscode.workspace.rootPath
                }, (err, stdout, stderr) => {
                    if (err) {
                        vscode.window.showErrorMessage('Git delete branch error:' + err);
                        reject(err);
                    }
                    else
                        resolve();
                });
            });
        }
    }
    class TD {
        constructor() {
            this._onDidChange = new vscode.EventEmitter();
        }
        provideTextDocumentContent(uri, token) {
            const compiledFunction = pug.compileFile(__dirname + '/index.pug');
            return compiledFunction({
                issues: globalIssues.issueCompacts.issue
            });
        }
    }
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 250);
    status.command = 'youtrack.list';
    status.text = 'Youtrack';
    status.show();
    context.subscriptions.push(status);
    let registryJSON;
    fs.readFile(__dirname + '/registry.json', 'utf-8', (err, data) => {
        if (!err) {
            registryJSON = JSON.parse(data);
            if (registryJSON['opened'] !== undefined) {
                status.text = registryJSON['opened'];
            }
        }
        else
            registryJSON = {};
    });
    function registryJSONUpdate() {
        fs.writeFile(__dirname + '/registry.json', JSON.stringify(registryJSON), err => {
            if (err)
                console.log(err);
        });
    }
    const myExtDir = vscode.extensions.getExtension('bulut4.youtrack').extensionPath;
    let config = vscode.workspace.getConfiguration('youtrack');
    let yt = new youTrack(config.get('userName', ''), config.get('password', ''), config.get('host', ''), config.get('filter', ''), config.get('path', ''));
    let provider = new TD();
    let registration = vscode.workspace.registerTextDocumentContentProvider('css-preview', provider);
    context.subscriptions.push(registration);
    let git = new _git();
    context.subscriptions.push(vscode.commands.registerCommand('youtrack.branch', (args) => {
        vscode.window.showInputBox({
            placeHolder: args,
            prompt: "Enter the name to new git branch"
        }).then((value) => {
            if (value) {
                git.currentBranch()
                    .then((branchName) => {
                    registryJSON['parentBranch'] = branchName.trim();
                    registryJSON['opened'] = args;
                    registryJSON['currentBranch'] = value;
                    registryJSONUpdate();
                    status.text = args;
                    git.branch(value);
                    yt.setState(args, 'In Progress')
                        .then(data => console.log(data));
                });
            }
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('youtrack.closeIssue', () => {
        git.checkout(registryJSON['parentBranch'])
            .then(() => git.merge(registryJSON['currentBranch']))
            .then(() => git.deleteBranch(registryJSON['currentBranch']))
            .then(() => yt.setState(registryJSON['currentBranch'], 'Fixed'))
            .then(() => {
            delete registryJSON['parentBranch'];
            delete registryJSON['opened'];
            delete registryJSON['currentBranch'];
            registryJSONUpdate();
            status.text = 'Youtrack';
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('youtrack.list', () => {
        yt.login()
            .then(() => yt.getIssue()
            .then(issues => {
            let prs = new xml2js.Parser();
            prs.parseString(issues, ((err, res) => {
                globalIssues = res;
                console.log(res);
                vscode.commands.executeCommand('vscode.previewHtml', vscode.Uri.parse('css-preview://test'), vscode.ViewColumn.Two, 'Youtrack Issue List').then((success) => {
                }, (reason) => {
                    vscode.window.showErrorMessage(reason);
                });
            }));
        }));
    }));
    vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === vscode.window.activeTextEditor.document) {
            // provider.update(previewUri);
        }
    });
}
exports.activate = activate;
// this method is called when your extension is deactivated
function deactivate() {
}
exports.deactivate = deactivate;
class youTrack {
    constructor(userName, password, host, filter, path) {
        this._login = false;
        this.host = host;
        this.userName = userName;
        this.password = password;
        this.filter = filter;
        this.basePath = path;
    }
    httpPost(path, method) {
        let self = this;
        let loginRequest = path.indexOf('/rest/user/login') > -1;
        return new Promise((resolve, reject) => {
            let options = {
                host: this.host,
                port: 443,
                path: self.basePath + path,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            };
            if (self._login) {
                options.headers['Cookie'] = self.cookie;
            }
            let postReq = https.request(options, function (res) {
                res.setEncoding('utf8');
                let data = '';
                res.on('data', function (chunk) {
                    data += chunk;
                });
                res.on('end', function () {
                    if (loginRequest) {
                        self.cookie = res.headers['set-cookie'];
                        if (data === '<login>ok</login>') {
                            self._login = true;
                            resolve(data);
                        }
                    }
                    else
                        resolve(data);
                });
            });
            postReq.end();
        });
    }
    login() {
        let self = this;
        return new Promise((resolve, reject) => {
            self.httpPost('/rest/user/login?login=' + encodeURIComponent(self.userName) + '&password=' + encodeURI(self.password), 'POST')
                .then(() => resolve());
        });
    }
    getIssue() {
        let self = this;
        return new Promise((resolve, reject) => {
            self.httpPost('/rest/issue?filter=' + encodeURIComponent(self.filter) + '&max=100', 'GET')
                .then(data => resolve(data));
        });
    }
    setState(issueId, state) {
        let self = this;
        return new Promise((resolve, reject) => {
            self.httpPost('/rest/issue/' + issueId + '/execute?command=' + encodeURIComponent('State ' + state), 'POST')
                .then(data => resolve(data));
        });
    }
}
//# sourceMappingURL=extension.js.map