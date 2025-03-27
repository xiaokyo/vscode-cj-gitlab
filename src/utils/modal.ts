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

  static error(message: string, ...items: string[]) {
    return vscode.window.showErrorMessage(message, ...items);
  }

  static warning(message: string, ...items: string[]) {
    return vscode.window.showWarningMessage(message, ...items);
  }

  static info(message: string, ...items: string[]) {
    return vscode.window.showInformationMessage(message, ...items);
  }
}
