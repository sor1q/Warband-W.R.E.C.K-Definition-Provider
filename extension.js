   const vscode = require('vscode');
   const fs = require('fs');
   const path = require('path');

   let fileCache = new Map();

   function activate(context) {
       vscode.workspace.onDidSaveTextDocument(() => {
           fileCache.clear();
       });

       // 1. Провайдер перехода к определению (Go to Definition с фильтрацией по префиксам)
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

               // Определяем префикс по тексту слева от слова
               const textBeforeWord = lineText.substring(0, range.start.character);
               let targetFileNames = [];

               const entityPrefixes = [
                   ['script', ['module_scripts.py', 'ID_scripts.py']],
                   ['trp', ['module_troops.py', 'ID_troops.py']],
                   ['itm', ['module_items.py', 'ID_items.py']],
                   ['p', ['module_parties.py', 'ID_parties.py']],
                   ['mnu', ['module_game_menus.py', 'ID_menus.py']],
                   ['fac', ['module_factions.py', 'ID_factions.py']],
                   ['scn', ['module_scenes.py', 'ID_scenes.py']],
                   ['qst', ['module_quests.py', 'ID_quests.py']],
                   ['snd', ['module_sounds.py', 'ID_sounds.py']],
                   ['prsnt', ['module_presentations.py', 'ID_presentations.py']],
                   ['skl', ['module_skills.py', 'ID_skills.py']],
                   ['anim', ['module_animations.py', 'ID_animations.py']],
                   ['mesh', ['module_meshes.py', 'ID_meshes.py']],
                   ['pt', ['module_party_templates.py', 'ID_party_templates.py']],
                   ['spr', ['module_scene_props.py', 'ID_scene_props.py']],
                   ['tableau', ['module_tableau_materials.py', 'ID_tableau_materials.py']],
                   ['icon', ['module_map_icons.py', 'ID_map_icons.py']],
                   ['mt', ['module_mission_templates.py', 'ID_mission_templates.py']],
                   ['track', ['module_music.py', 'ID_music.py']],
                   ['psys', ['module_particle_systems.py', 'ID_particle_systems.py']],
                   ['ip', ['module_info_pages.py', 'ID_info_pages.py']],
                   ['s', ['module_strings.py', 'ID_strings.py']],
               ];
               for (const [prefix, files] of entityPrefixes) {
                   if (new RegExp('(?:^|[^a-zA-Z0-9_])' + prefix + '\\.\\s*$', 'i').test(textBeforeWord)) {
                       targetFileNames = files;
                       break;
                   }
               }

               // Также ищем в соответствующих pbod_* файлах (module_X.py → pbod_X.py),
               // чтобы переход к определению работал для скриптов/сущностей из pbod-режимов
               if (targetFileNames.length > 0) {
                   for (const fileName of targetFileNames.slice()) {
                       const pbodName = fileName.replace(/^module_/, 'pbod_');
                       if (pbodName !== fileName && !targetFileNames.includes(pbodName)) {
                           targetFileNames.push(pbodName);
                       }
                   }
               }

               const files = getPythonFiles(rootPath, true);

               for (const filePath of files) {
                   const fileName = path.basename(filePath);

                   if (targetFileNames.length > 0 && !targetFileNames.includes(fileName)) {
                       continue;
                   }

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
                const isLocal = /(?:^|[^a-zA-Z0-9_])(?:l\.|:)\s*[\w]*$/.test(linePrefix);
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
                const isGlobal = /(?:^|[^a-zA-Z0-9_])g\.\s*[\w]*$/.test(linePrefix);
               if (isGlobal) {
                   const globalVars = getAllGlobalVariables(rootPath);
                   for (const gVar of globalVars) {
                       let cleanVar = gVar;
                       if (cleanVar.startsWith('$g_')) cleanVar = cleanVar.substring(3);
                       else if (cleanVar.startsWith('g_')) cleanVar = cleanVar.substring(2);
                       else if (cleanVar.startsWith('$')) cleanVar = cleanVar.substring(1);

                       if (!seen.has(cleanVar)) {
                           seen.add(cleanVar);
                           const item = new vscode.CompletionItem(cleanVar, vscode.CompletionItemKind.Variable);
                           item.detail = 'Global Variable';
                           completions.push(item);
                       }
                   }
                   return completions;
               }

                // Находимся ли курсор уже внутри открытой скобки "(...".
                // Внутри скобок вставляем только имя операции (без повторных скобок
                // и плейсхолдеров), снаружи — полный шаблон "(op, arg1, arg2)".
                let parenDepth = 0;
                for (let i = 0; i < linePrefix.length; i++) {
                    const ch = linePrefix[i];
                    if (ch === '(') parenDepth++;
                    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
                }
                const isInsideParens = parenDepth > 0;

                // Сниппеты (раскрытие в try_begin/try_end и т.д.)
                // НЕ срабатывают, если перед словом есть точка (контекст сущности: script., trp. и т.д.)
                const snippetMap = {
                    'try_begin': ['(try_begin),', '\t$0', '(try_end),'],
                    'try_for_agents': ['(try_for_agents, l.agent_no),', '\t$1', '(try_end),$0'],
                    'try_for_parties': ['(try_for_parties, l.party_no),', '\t$1', '(try_end),$0'],
                    'try_for_range': ['(try_for_range, ${1:unused}, ${2:_begin}, ${3:_end}),', '\t$4', '(try_end),$0'],
                    'try_for_range_backwards': ['(try_for_range_backwards, ${1:unused}, ${2:_begin}, ${3:_end}),', '\t$4', '(try_end),$0'],
                };
                const snippetPrefixes = Object.keys(snippetMap);
                const hasDotBeforeWord = /\.\s*\w*$/.test(linePrefix);
                const snippetWordMatch = hasDotBeforeWord ? null : linePrefix.match(/([a-zA-Z_][a-zA-Z0-9_]*)$/);
                const snippetFilter = snippetWordMatch ? snippetWordMatch[1] : '';
                let snippetAdded = false;
                if (snippetFilter.length > 0) {
                    for (const p of snippetPrefixes) {
                        if (p.toLowerCase().startsWith(snippetFilter.toLowerCase())) {
                            let body = snippetMap[p];
                            // Если скобка уже открыта пользователем — не дублируем её
                            if (isInsideParens) {
                                body = [body[0].replace(/^\(/, '')].concat(body.slice(1));
                            }
                            const item = new vscode.CompletionItem(p, vscode.CompletionItemKind.Snippet);
                            item.insertText = new vscode.SnippetString(body.join('\n'));
                            item.detail = 'Snippet';
                            item.range = new vscode.Range(position.line, position.character - snippetFilter.length, position.line, position.character);
                            if (!seen.has(p)) {
                                seen.add(p);
                                completions.push(item);
                                snippetAdded = true;
                            }
                        }
                    }
                    // Не делаем return, чтобы обычные операции тоже добавились
                }



               // Определяем целевой файл по префиксу сущности
               let targetFileNames = [];
               let stripPrefix = null;

               const entityPrefixes = [
                   ['script', ['module_scripts.py'], null],
                   ['trp', ['module_troops.py', 'ID_troops.py'], 'trp_'],
                   ['itm', ['module_items.py', 'ID_items.py'], 'itm_'],
                   ['p', ['module_parties.py', 'ID_parties.py'], 'p_'],
                   ['mnu', ['module_game_menus.py', 'ID_menus.py'], 'mnu_'],
                   ['fac', ['module_factions.py', 'ID_factions.py'], 'fac_'],
                   ['scn', ['module_scenes.py', 'ID_scenes.py'], 'scn_'],
                   ['qst', ['module_quests.py', 'ID_quests.py'], 'qst_'],
                   ['snd', ['module_sounds.py', 'ID_sounds.py'], 'snd_'],
                   ['prsnt', ['module_presentations.py', 'ID_presentations.py'], 'prsnt_'],
                   ['skl', ['module_skills.py', 'ID_skills.py'], 'skl_'],
                   ['anim', ['module_animations.py', 'ID_animations.py'], 'anim_'],
                   ['mesh', ['module_meshes.py', 'ID_meshes.py'], 'mesh_'],
                   ['pt', ['module_party_templates.py', 'ID_party_templates.py'], 'pt_'],
                   ['spr', ['module_scene_props.py', 'ID_scene_props.py'], 'spr_'],
                   ['tableau', ['module_tableau_materials.py', 'ID_tableau_materials.py'], 'tableau_'],
                   ['icon', ['module_map_icons.py', 'ID_map_icons.py'], 'icon_'],
                   ['mt', ['module_mission_templates.py', 'ID_mission_templates.py'], 'mt_'],
                   ['track', ['module_music.py', 'ID_music.py'], 'track_'],
                   ['psys', ['module_particle_systems.py', 'ID_particle_systems.py'], 'psys_'],
                   ['ip', ['module_info_pages.py', 'ID_info_pages.py'], 'ip_'],
                   ['s', ['module_strings.py', 'ID_strings.py'], 'str_'],
               ];
               for (const [prefix, files, strip] of entityPrefixes) {
                   if (new RegExp('(?:^|[^a-zA-Z0-9_])' + prefix + '\\.\\s*[\\w]*$').test(linePrefix)) {
                       targetFileNames = files;
                       stripPrefix = strip;
                       break;
                   }
               }

               // Также ищем в соответствующих pbod_* файлах (module_X.py → pbod_X.py),
               // чтобы подсказки работали для скриптов/сущностей из pbod-режимов
               // (pbod_scripts, pbod_items, pbod_troops и т.д.)
               if (targetFileNames.length > 0) {
                   for (const fileName of targetFileNames.slice()) {
                       const pbodName = fileName.replace(/^module_/, 'pbod_');
                       if (pbodName !== fileName && !targetFileNames.includes(pbodName)) {
                           targetFileNames.push(pbodName);
                       }
                   }
               }

                // Неизвестный префикс вида "foo." — не подсказывать всё подряд
                if (targetFileNames.length === 0 && /[a-zA-Z_][a-zA-Z0-9_]*\.\s*[\w]*$/.test(linePrefix)) {
                    return [];
                }

                // Встроенные регистры (reg0, s1, pos2, arg3, ...) — константы не подсказывать
                if (targetFileNames.length === 0) {
                    const wordMatch = /[a-zA-Z_][a-zA-Z0-9_]*$/.exec(linePrefix);
                    const currentWord = wordMatch ? wordMatch[0] : '';
                    if (/^(reg|s|pos|arg|i|f)\d+$/.test(currentWord)) {
                        return [];
                    }
                }

                // Автокомплит операций из header_operations.py
                // Срабатывает при вводе части имени операции (например, store_add)
                // без необходимости писать скобку (
                // НЕ срабатывает, если используется известный префикс сущности (script., trp. и т.д.)
                const isKnownEntityPrefix = /(?:^|[^a-zA-Z0-9_])(?:l\.|g\.|script|trp|itm|p|mnu|fac|scn|qst|snd|prsnt|skl|anim|mesh|pt|spr|tableau|icon|mt|track|psys|ip|s)\.\s*[\w]*$/.test(linePrefix);
                if (!isKnownEntityPrefix && targetFileNames.length === 0) {
                    const opWordMatch = linePrefix.match(/([a-zA-Z_][a-zA-Z0-9_]*)$/);
                    const opFilter = opWordMatch ? opWordMatch[1] : '';
                    if (opFilter.length > 0) {
                        const operations = getOperations(rootPath);
                        const customOps = getWreckCustomOperations(rootPath);
                        // Объединяем обычные операции с кастомными WRECK
                        const allOps = new Map(operations);
                        for (const [name, info] of customOps) {
                            allOps.set(name, info);
                        }
                        const startChar = position.character - opFilter.length;
                        let opsAdded = false;
                        for (const [name, info] of allOps) {
                            // Пропускаем операции, для которых есть сниппет (они раскрываются отдельно)
                            if (snippetPrefixes.includes(name)) continue;
                            if (name.toLowerCase().startsWith(opFilter.toLowerCase())) {
                                let item;
                                // Операторы-модификаторы без скобок (bitwise флаги)
                                const noParenOps = ['neg', 'this_or_next'];
                                if (noParenOps.includes(name) || isInsideParens) {
                                    // Внутри уже открытой скобки вставляем только имя операции
                                    item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Method);
                                    item.insertText = name; // без скобок и параметров
                                } else if (info.args && info.args.length > 0) {
                                    const params = info.args.map((arg, i) => '${' + (i + 1) + ':' + arg + '}').join(', ');
                                    item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Method);
                                    item.insertText = new vscode.SnippetString('(' + name + ', ' + params + ')');
                                } else {
                                    item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Method);
                                    item.insertText = new vscode.SnippetString('(' + name + ')');
                                }
                                item.detail = 'Operation';
                                item.range = new vscode.Range(position.line, startChar, position.line, position.character);
                                if (!seen.has(name)) {
                                    seen.add(name);
                                    completions.push(item);
                                    opsAdded = true;
                                }
                            }
                        }
                        if (opsAdded) return completions;
                    }
                }


               const files = getPythonFiles(rootPath, true);

               for (const filePath of files) {
                   const fileName = path.basename(filePath);
                   const isPluginFile = fileName.startsWith('plugin_') && fileName.endsWith('.py');
                   
                   if (targetFileNames.length > 0) {
                       if (!targetFileNames.includes(fileName)) continue;
                    } else {
                        if (fileName !== 'module_constants.py' && !isPluginFile) continue;
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
                           } else if (isPluginFile) {
                               match = trimmed.match(/^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
                           } else {
                               match = trimmed.match(/^[\(\[]\s*['"]([a-zA-Z0-9_]+)['"]\s*,/) || trimmed.match(/^([a-zA-Z0-9_]+)\s*=/);
                           }

                           if (match && match[1]) {
                               let name = match[1];
                               
                               if (stripPrefix && name.startsWith(stripPrefix)) {
                                   name = name.substring(stripPrefix.length);
                               }

                               if (!seen.has(name)) {
                                   seen.add(name);
                                   let kind;
                                   if (isPluginFile) {
                                       kind = vscode.CompletionItemKind.Function;
                                   } else {
                                       kind = targetFileNames.length > 0 ? vscode.CompletionItemKind.Reference : vscode.CompletionItemKind.Constant;
                                   }
                                   completions.push(new vscode.CompletionItem(name, kind));
                               }
                           }
                       }
                   } catch (e) {}
               }

               return completions;
           }
       }, '.', ':', '"', "'", '_', 'g', 'a', 'b', 'c', 'd', 'e', 'f', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'A', 'B', 'C', 'D', 'E', 'F', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9');

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
        const regex = /(?:\b(?:g\.|g_|\$g_|\$))([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

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
                   if (!varName.match(/^(reg\d+|f\d+|s\d+|arg\d+|towns|castles|villages)$/i)) {
                       globals.add(varName);
                   }
               }
           } catch (e) {}
       }
       return Array.from(globals);
   }

   function getOperations(rootPath) {
       const operations = new Map();
       const files = getPythonFiles(rootPath, true);
       const defRegex = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*[^#]*#\s*\(([^)]*)\)/;
       for (const filePath of files) {
           const fileName = path.basename(filePath);
           if (fileName !== 'header_operations.py') continue;
           try {
               let content = fileCache.get(filePath);
               if (!content) {
                   content = fs.readFileSync(filePath, 'utf-8');
                   fileCache.set(filePath, content);
               }
               const lines = content.split(/\r?\n/);
               for (const line of lines) {
                   const trimmed = line.trim();
                   if (trimmed.startsWith('#')) continue;
                   const match = trimmed.match(defRegex);
                   if (!match) continue;
                   const name = match[1];
                   const argsStr = match[2];
                   const parts = argsStr.split(',');
                   const args = [];
                   for (let i = 1; i < parts.length; i++) {
                       let arg = parts[i].trim();
                       // Если есть "|", берём часть после него (для модификаторов типа neg|<op>)
                       const pipeIdx = arg.indexOf('|');
                       if (pipeIdx >= 0) arg = arg.substring(pipeIdx + 1);
                       // Извлекаем первое валидное имя аргумента (слово из букв, цифр, _
                       const argNameMatch = arg.match(/[a-zA-Z_][a-zA-Z0-9_]*/);
                       if (argNameMatch) args.push(argNameMatch[0]);
                   }
                   operations.set(name, { args });
               }
           } catch (e) {}
       }
       return operations;
   }


    function getWreckCustomOperations(rootPath) {
        const operations = new Map();
        const files = getPythonFiles(rootPath, true);
        // Ищем extend_syntax(...) в plugin_*.py файлах
        // Формат: extend_syntax(ui_create_mesh)         # (ui_create_mesh, <destination>, <mesh>, <x>, <y>, [<scale_x>], [<scale_y>], [<color>]),
        const extendRegex = /extend_syntax\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)\s*#\s*\(([^)]*)\)/;
        for (const filePath of files) {
            const fileName = path.basename(filePath);
            if (!fileName.startsWith('plugin_') || !fileName.endsWith('.py')) continue;
            try {
                let content = fileCache.get(filePath);
                if (!content) {
                    content = fs.readFileSync(filePath, 'utf-8');
                    fileCache.set(filePath, content);
                }
                const lines = content.split(/\r?\n/);
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('#')) continue;
                    const match = trimmed.match(extendRegex);
                    if (!match) continue;
                    const name = match[1];
                    const argsStr = match[2];
                    const parts = argsStr.split(',');
                    const args = [];
                    for (let i = 1; i < parts.length; i++) {
                        let arg = parts[i].trim();
                        const pipeIdx = arg.indexOf('|');
                        if (pipeIdx >= 0) arg = arg.substring(pipeIdx + 1);
                        const argNameMatch = arg.match(/[a-zA-Z_][a-zA-Z0-9_]*/);
                        if (argNameMatch) args.push(argNameMatch[0]);
                    }
                    operations.set(name, { args });
                }
            } catch (e) {}
        }
        return operations;
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
