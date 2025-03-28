import * as vscode from "vscode";

export default class Modal {
  constructor() {}

  static error(
    message: string,
    options: vscode.MessageOptions = {},
    ...items: string[]
  ) {
    return vscode.window.showErrorMessage(
      message,
      { modal: true, ...options },
      ...items
    );
  }

  static warning(
    message: string,
    options: vscode.MessageOptions = {},
    ...items: string[]
  ) {
    return vscode.window.showWarningMessage(
      message,
      { modal: true, ...options },
      ...items
    );
  }

  static info(
    message: string,
    options: vscode.MessageOptions = {},
    ...items: string[]
  ) {
    return vscode.window.showInformationMessage(
      message,
      { modal: true, ...options },
      ...items
    );
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
