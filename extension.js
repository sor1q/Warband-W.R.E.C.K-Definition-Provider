const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context) {
    const provider = vscode.languages.registerDefinitionProvider('python', {
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
                    // Ищем паттерн объявления типа ("имя", [ или 'имя', [
                    const regex = new RegExp(`^\\s*\\(\\s*['"]${word}['"]\\s*,`, 'i');
                    if (regex.test(line)) {
                        const targetUri = vscode.Uri.file(filePath);
                        const targetPosition = new vscode.Position(i, line.indexOf(word));
                        return new vscode.Location(targetUri, targetPosition);
                    }
                }
            }
            return null;
        }
    });

                    context.subscriptions.push(provider);
}

function getPythonFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        // Исключаем лишние папки, чтобы не сканировать лишнее
        if (filePath.includes('node_modules') || filePath.includes('.git') || filePath.includes('build')) continue;

        if (fs.statSync(filePath).isDirectory()) {
            getPythonFiles(filePath, fileList);
        } else if (file.endsWith('.py')) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

function deactivate() {}

async function provideDefinition(document, position, token) {
    // Дублирующая заглушка для корректного экспорта в Module System VS Code
}

module.exports = {
    activate,
    deactivate
};
