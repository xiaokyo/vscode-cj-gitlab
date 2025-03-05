import * as vscode from 'vscode';
import { CJGitlabView } from './CJGitlabView';

export function activate(context: vscode.ExtensionContext) {
    const provider = new CJGitlabView(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'cjGitlab',
            provider,
            {
                webviewOptions: { retainContextWhenHidden: true }
            }
        )
    );
}

export function deactivate() {}
