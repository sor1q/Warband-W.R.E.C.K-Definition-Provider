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

                            // Автокомплит глобальных переменных (срабатывает строго при вводе g., но ищет и g. и $g_)
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

                            // Определяем целевой файл по префиксу сущности (script., trp., itm. и т.д.)
                            let targetFileName = null;
                            if (/script\.\s*([\w]*)$/.test(linePrefix)) targetFileName = 'module_scripts.py';
                            else if (/trp\.\s*([\w]*)$/.test(linePrefix)) targetFileName = 'module_troops.py';
                            else if (/itm\.\s*([\w]*)$/.test(linePrefix)) targetFileName = 'module_items.py';
                            else if (/mnu\.\s*([\w]*)$/.test(linePrefix)) targetFileName = 'module_game_menus.py';
                            else if (/fac\.\s*([\w]*)$/.test(linePrefix)) targetFileName = 'module_factions.py';
                            else if (/scn\.\s*([\w]*)$/.test(linePrefix)) targetFileName = 'module_scenes.py';
                            else if (/qst\.\s*([\w]*)$/.test(linePrefix)) targetFileName = 'module_quests.py';
                            else if (/snd\.\s*([\w]*)$/.test(linePrefix)) targetFileName = 'module_sounds.py';
                            else if (/prsnt\.\s*([\w]*)$/.test(linePrefix)) targetFileName = 'module_presentations.py';

                            const files = getPythonFiles(rootPath, true);

                            for (const filePath of files) {
                                const fileName = path.basename(filePath);

                                if (targetFileName) {
                                    if (fileName !== targetFileName) continue;
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
                                            const name = match[1];
                                            if (!seen.has(name)) {
                                                seen.add(name);
                                                const kind = targetFileName ? vscode.CompletionItemKind.Reference : vscode.CompletionItemKind.Constant;
                                                completions.push(new vscode.CompletionItem(name, kind));
                                            }
                                        }
                                    }
                                } catch (e) {}
                            }

                            return completions;
                        }
                    }, '.', ':', '"', "'", '_', 'g');

                                            context.subscriptions.push(definitionProvider, completionProvider);
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

    // Ищет:
    // 1. g.name
    // 2. $g_name или любые другие $variables (кроме чисел вроде $1, $reg1)
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
                // Исключаем локальные регистры/аргументы, если они случайно попали под $
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
