import * as vscode from "vscode";

export default class Modal {
  constructor() {}

  static error(message: string) {
    vscode.window.showErrorMessage(message, { modal: true });
  }

  static warning(message: string) {
    vscode.window.showWarningMessage(message, { modal: true });
  }

  static info(message: string) {
    vscode.window.showInformationMessage(message, { modal: true });
  }
}

export class Toast {
  constructor() {}

  static error(message: string) {
    vscode.window.showErrorMessage(message);
  }

  static warning(message: string) {
    vscode.window.showWarningMessage(message);
  }

  static info(message: string) {
    vscode.window.showInformationMessage(message);
  }
}
