   const vscode = require('vscode');
   const fs = require('fs');
   const path = require('path');

   function activate(context) {
       // 1. Провайдер перехода к определению (Go to Definition)
       const definitionProvider = vscode.languages.registerDefinitionProvider('python', {
           async provideDefinition(document, position, token) {
               const range = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_]+/);
               if (!range) return null;

               const word = document.getText(range);
               const workspaceFolders = vscode.workspace.workspaceFolders;
               if (!workspaceFolders) return null;

               const rootPath = workspaceFolders[0].uri.fsPath;
               const files = getPythonFiles(rootPath);

               for (const filePath of files) {
                   const content = fs.readFileSync(filePath, 'utf-8');
                   const lines = content.split(/\r?\n/);

                   for (let i = 0; i < lines.length; i++) {
                       const line = lines[i];
                       const trimmed = line.trim();
                       if (trimmed.startsWith('#')) continue;

                       const entityRegex = new RegExp(`^\\s*[\\(\\[]\\s*['"]${word}['"]\\s*,`, 'i');
                       const varRegex = new RegExp(`^\\s*${word}\\s*=`, 'i');

                       if (entityRegex.test(line) || varRegex.test(line)) {
                           const targetUri = vscode.Uri.file(filePath);
                           const targetPosition = new vscode.Position(i, line.indexOf(word));
                           return new vscode.Location(targetUri, targetPosition);
                       }
                   }
               }
               return null;
           }
       });

                       // 2. Провайдер автодополнения (Completion Item Provider)
                       const completionProvider = vscode.languages.registerCompletionItemProvider('python', {
                           provideCompletionItems(document, position, token, context) {
                               const workspaceFolders = vscode.workspace.workspaceFolders;
                               if (!workspaceFolders) return [];

                               const rootPath = workspaceFolders[0].uri.fsPath;
                               const files = getPythonFiles(rootPath);
                               const completions = [];
                               const seen = new Set();

                               for (const filePath of files) {
                                   try {
                                       const content = fs.readFileSync(filePath, 'utf-8');
                                       const lines = content.split(/\r?\n/);

                                       for (const line of lines) {
                                           const trimmed = line.trim();
                                           if (trimmed.startsWith('#')) continue;

                                           // Ищем паттерны: ("name", ...), ["name", ...] или name = ...
                                           const match = trimmed.match(/^[\(\[]\s*['"]([a-zA-Z0-9_]+)['"]\s*,/) || trimmed.match(/^([a-zA-Z0-9_]+)\s*=/);
                                           if (match && match[1]) {
                                               const name = match[1];
                                               if (!seen.has(name)) {
                                                   seen.add(name);
                                                   completions.push(new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable));
                                               }
                                           }
                                       }
                                   } catch (e) {
                                       // Игнорируем ошибки чтения файлов
                                   }
                               }
                               return completions;
                           }
                       }, '.', '"', "'"); // Триггеры автодополнения

                                           context.subscriptions.push(definitionProvider, completionProvider);
   }

   function getPythonFiles(dir, fileList = []) {
       const files = fs.readdirSync(dir);
       for (const file of files) {
           const filePath = path.join(dir, file);
           if (
               filePath.includes('node_modules') ||
               filePath.includes('.git') ||
               filePath.includes('build') ||
               filePath.endsWith('compiler.py') ||
               file.startsWith('ID_')
           ) {
               continue;
           }

           if (fs.statSync(filePath).isDirectory()) {
               getPythonFiles(filePath, fileList);
           } else if (file.endsWith('.py')) {
               fileList.push(filePath);
           }
       }
       return fileList;
   }

   function deactivate() {}

   module.exports = {
       activate,
       deactivate
   };
