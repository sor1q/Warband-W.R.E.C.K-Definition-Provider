
   const vscode = require('vscode');
   const fs = require('fs');
   const path = require('path');

   let fileCache = new Map();

   function activate(context) {
       vscode.workspace.onDidSaveTextDocument(() => {
           fileCache.clear();
       });

       // 1. Провайдер перехода к определению (Go to Definition)
       const definitionProvider = vscode.languages.registerDefinitionProvider('python', {
           async provideDefinition(document, position, token) {
               const lineText = document.lineAt(position.line).text;
               if (!lineText.trim()) return null;

               const range = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_:]+/);
               if (!range) return null;

               const word = document.getText(range).replace(/^:/, '');
               const workspaceFolders = vscode.workspace.workspaceFolders;
               if (!workspaceFolders) return null;

               const rootPath = workspaceFolders[0].uri.fsPath;
               const files = getPythonFiles(rootPath, true);

               for (const filePath of files) {
                   let content = fileCache.get(filePath);
                   if (!content) {
                       try {
                           content = fs.readFileSync(filePath, 'utf-8');
                           fileCache.set(filePath, content);
                       } catch (e) {
                           continue;
                       }
                   }

                   const lines = content.split(/\r?\n/);
                   for (let i = 0; i < lines.length; i++) {
                       const line = lines[i];
                       const trimmed = line.trim();
                       if (trimmed.startsWith('#')) continue;

                       if (path.basename(filePath) === 'module_game_menus.py') {
                           const regex = new RegExp(`['"]${word}['"]\\s*,`, 'i');
                           if (!regex.test(trimmed)) continue;

                           let nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : '';
                           let combined = trimmed + ' ' + nextLine;
                           if (/['"][\w_]+['"]\s*,\s*\[/.test(combined) || nextLine.startsWith('[')) {
                               continue;
                           }

                           const targetUri = vscode.Uri.file(filePath);
                           const targetPosition = new vscode.Position(i, line.indexOf(word));
                           return new vscode.Location(targetUri, targetPosition);
                       }

                       const entityRegex = new RegExp(`^\\s*[\\(\\[]\\s*['"]${word}['"]\\s*,`, 'i');
                       const varRegex = new RegExp(`^\\s*${word}\\s*=`, 'i');
                       const localDefRegex = new RegExp(`(:|l\\.|\$g_|g\\.)\\b${word}\\b`, 'i');

                       if (entityRegex.test(line) || varRegex.test(line) || localDefRegex.test(line)) {
                           const targetUri = vscode.Uri.file(filePath);
                           const targetPosition = new vscode.Position(i, line.indexOf(word));
                           return new vscode.Location(targetUri, targetPosition);
                       }
                   }
               }
               return null;
           }
       });

                       // 2. Контекстное автодополнение
                       const completionProvider = vscode.languages.registerCompletionItemProvider('python', {
                           provideCompletionItems(document, position, token, context) {
                               const workspaceFolders = vscode.workspace.workspaceFolders;
                               if (!workspaceFolders) return [];

                               const linePrefix = document.lineAt(position).text.substr(0, position.character);
                               const completions = [];
                               const seen = new Set();
                               const rootPath = workspaceFolders[0].uri.fsPath;

                               // Автокомплит локальных переменных (l. или :)
                               const isLocal = /(?:l\.|:)\s*[\w]*$/.test(linePrefix);
                               if (isLocal) {
                                   const localVars = getLocalVariablesInCurrentScope(document.getText(), position.line);
                                   for (const v of localVars) {
                                       if (!seen.has(v)) {
                                           seen.add(v);
                                           const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.Variable);
                                           item.detail = 'Local Variable';
                                           completions.push(item);
                                       }
                                   }
                                   return completions;
                               }

                               // Автокомплит глобальных переменных (срабатывает строго при вводе g.)
                               const isGlobal = /g\.\s*[\w]*$/.test(linePrefix);
                               if (isGlobal) {
                                   const globalVars = getAllGlobalVariables(rootPath);
                                   for (const gVar of globalVars) {
                                       if (!seen.has(gVar)) {
                                           seen.add(gVar);
                                           const item = new vscode.CompletionItem(gVar, vscode.CompletionItemKind.Variable);
                                           item.detail = 'Global Variable';
                                           completions.push(item);
                                       }
                                   }
                                   return completions;
                               }

                               // Определяем целевой файл по префиксу сущности
                               let targetFileNames = [];
                               let stripPrefix = null;

                               if (/script\.\s*([\w]*)$/.test(linePrefix)) {
                                   targetFileNames = ['module_scripts.py'];
                               } else if (/trp\.\s*([\w]*)$/.test(linePrefix)) {
                                   targetFileNames = ['module_troops.py', 'ID_troops.py'];
                                   stripPrefix = 'trp_';
                               } else if (/itm\.\s*([\w]*)$/.test(linePrefix)) {
                                   targetFileNames = ['module_items.py', 'ID_items.py'];
                                   stripPrefix = 'itm_';
                               } else if (/p\.\s*([\w]*)$/.test(linePrefix)) {
                                   targetFileNames = ['module_parties.py', 'ID_parties.py'];
                                   stripPrefix = 'p_';
                               } else if (/mnu\.\s*([\w]*)$/.test(linePrefix)) {
                                   targetFileNames = ['module_game_menus.py', 'ID_menus.py'];
                                   stripPrefix = 'mnu_';
                               } else if (/fac\.\s*([\w]*)$/.test(linePrefix)) {
                                   targetFileNames = ['module_factions.py', 'ID_factions.py'];
                                   stripPrefix = 'fac_';
                               } else if (/scn\.\s*([\w]*)$/.test(linePrefix)) {
                                   targetFileNames = ['module_scenes.py', 'ID_scenes.py'];
                                   stripPrefix = 'scn_';
                               } else if (/qst\.\s*([\w]*)$/.test(linePrefix)) {
                                   targetFileNames = ['module_quests.py', 'ID_quests.py'];
                                   stripPrefix = 'qst_';
                               } else if (/snd\.\s*([\w]*)$/.test(linePrefix)) {
                                   targetFileNames = ['module_sounds.py', 'ID_sounds.py'];
                                   stripPrefix = 'snd_';
                               } else if (/prsnt\.\s*([\w]*)$/.test(linePrefix)) {
                                   targetFileNames = ['module_presentations.py', 'ID_presentations.py'];
                                   stripPrefix = 'prsnt_';
                               }

                               const files = getPythonFiles(rootPath, true);

                               for (const filePath of files) {
                                   const fileName = path.basename(filePath);

                                   if (targetFileNames.length > 0) {
                                       if (!targetFileNames.includes(fileName)) continue;
                                   } else {
                                       const isConstantFile = fileName === 'module_constants.py' || fileName.startsWith('ID_');
                                       if (!isConstantFile) continue;
                                   }

                                   try {
                                       let content = fileCache.get(filePath);
                                       if (!content) {
                                           content = fs.readFileSync(filePath, 'utf-8');
                                           fileCache.set(filePath, content);
                                       }

                                       const lines = content.split(/\r?\n/);
                                       for (let i = 0; i < lines.length; i++) {
                                           const line = lines[i];
                                           const trimmed = line.trim();
                                           if (trimmed.startsWith('#')) continue;

                                           let match = null;
                                           if (fileName === 'module_game_menus.py') {
                                               const menuMatch = trimmed.match(/['"]([a-zA-Z0-9_]+)['"]\s*,/);
                                               if (menuMatch && menuMatch[1]) {
                                                   let nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : '';
                                                   let combined = trimmed + ' ' + nextLine;
                                                   if (/['"][\w_]+['"]\s*,\s*\[/.test(combined) || nextLine.startsWith('[')) {
                                                       continue;
                                                   }
                                                   match = menuMatch;
                                               }
                                           } else {
                                               match = trimmed.match(/^[\(\[]\s*['"]([a-zA-Z0-9_]+)['"]\s*,/) || trimmed.match(/^([a-zA-Z0-9_]+)\s*=/);
                                           }

                                           if (match && match[1]) {
                                               let name = match[1];

                                               // Если включено срезание префикса (например, p_town_1 -> town_1)
                                               if (stripPrefix && name.startsWith(stripPrefix)) {
                                                   name = name.substring(stripPrefix.length);
                                               }

                                               if (!seen.has(name)) {
                                                   seen.add(name);
                                                   const kind = targetFileNames.length > 0 ? vscode.CompletionItemKind.Reference : vscode.CompletionItemKind.Constant;
                                                   completions.push(new vscode.CompletionItem(name, kind));
                                               }
                                           }
                                       }
                                   } catch (e) {}
                               }

                               return completions;
                           }
                       }, '.', ':', '"', "'", '_', 'g');

                                               // 3. Провайдер навигации по секциям (Outline / Go to Symbol)
                                               const documentSymbolProvider = vscode.languages.registerDocumentSymbolProvider('python', {
                                                   provideDocumentSymbols(document, token) {
                                                       const fileName = path.basename(document.uri.fsPath);
                                                       const symbols = [];
                                                       const text = document.getText();
                                                       const lines = text.split(/\r?\n/);

                                                       let currentSection = null;
                                                       let detailName = 'Section';
                                                       let symbolKind = vscode.SymbolKind.Namespace;

                                                       if (fileName === 'module_scripts.py') {
                                                           detailName = 'Script Block';
                                                       } else if (fileName === 'module_game_menus.py') {
                                                           detailName = 'Menu Section';
                                                       } else if (fileName === 'module_dialogs.py') {
                                                           detailName = 'Dialog Group';
                                                       }

                                                       for (let i = 0; i < lines.length; i++) {
                                                           const line = lines[i];

                                                           const sectionMatch = line.match(/^#\s*---?\s*SECTION:\s*(.+?)\s*-*$/i);
                                                           if (sectionMatch) {
                                                               const title = sectionMatch[1].trim();
                                                               const range = new vscode.Range(i, 0, i, line.length);

                                                               currentSection = new vscode.DocumentSymbol(
                                                                   title,
                                                                   detailName,
                                                                   symbolKind,
                                                                   range,
                                                                   range
                                                               );
                                                               symbols.push(currentSection);
                                                               continue;
                                                           }

                                                           const subSectionMatch = line.match(/^#\s*--\s*Sub-section:\s*(.+)$/i);
                                                           if (subSectionMatch) {
                                                               const title = subSectionMatch[1].trim();
                                                               const range = new vscode.Range(i, 0, i, line.length);

                                                               const subSymbol = new vscode.DocumentSymbol(
                                                                   title,
                                                                   'Sub-section',
                                                                   vscode.SymbolKind.Module,
                                                                   range,
                                                                   range
                                                               );

                                                               if (currentSection) {
                                                                   currentSection.children.push(subSymbol);
                                                               } else {
                                                                   symbols.push(subSymbol);
                                                               }
                                                           }
                                                       }

                                                       return symbols;
                                                   }
                                               });

                                               context.subscriptions.push(definitionProvider, completionProvider, documentSymbolProvider);
   }

   function getLocalVariablesInCurrentScope(documentText, cursorLine) {
       const lines = documentText.split(/\r?\n/);
       const locals = new Set();
       const start = Math.max(0, cursorLine - 100);
       const end = Math.min(lines.length, cursorLine + 50);
       const regex = /(?::|l\.)([a-zA-Z0-9_]+)\b/g;

       for (let i = start; i < end; i++) {
           let match;
           while ((match = regex.exec(lines[i])) !== null) {
               locals.add(match[1]);
           }
       }
       return Array.from(locals);
   }

   function getAllGlobalVariables(rootPath) {
       const globals = new Set();
       const files = getPythonFiles(rootPath, true);
       const regex = /(?:g\.|\$)([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

       for (const filePath of files) {
           try {
               let content = fileCache.get(filePath);
               if (!content) {
                   content = fs.readFileSync(filePath, 'utf-8');
                   fileCache.set(filePath, content);
               }
               let match;
               while ((match = regex.exec(content)) !== null) {
                   const varName = match[1];
                   if (!varName.match(/^(reg\d+|f\d+|s\d+|arg\d+)$/i)) {
                       globals.add(varName);
                   }
               }
           } catch (e) {}
       }
       return Array.from(globals);
   }

   function getPythonFiles(dir, includeIDs = false, fileList = []) {
       const files = fs.readdirSync(dir);
       for (const file of files) {
           const filePath = path.join(dir, file);
           if (
               filePath.includes('node_modules') ||
               filePath.includes('.git') ||
               filePath.includes('build') ||
               filePath.endsWith('compiler.py') ||
               (!includeIDs && file.startsWith('ID_'))
           ) {
               continue;
           }

           if (fs.statSync(filePath).isDirectory()) {
               getPythonFiles(filePath, includeIDs, fileList);
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
