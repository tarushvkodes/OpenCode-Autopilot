/**
 * Dependency status display and reporting
 */
import * as vscode from 'vscode';
import { DependencyCheckResults, DependencyStatus } from './types';
import { DebugEmojis } from '../../core/constants/ui-strings';
import { showInfo, showErrorFromException } from '../../utils/notifications';

export function showDependencyStatus(results: DependencyCheckResults): void {
    const status = analyzeDependencyStatus(results);
    
    if (status.allReady) {
        showInfo(status.successMessages[0]);
    } else {
        // First show error message with dependency file button
        const errorSummary = status.issues.join('\n');
        vscode.window.showErrorMessage(
            `Missing dependencies detected:\n\n${errorSummary}`,
            'View Dependency Report',
            'Install Missing Dependencies'
        ).then(selection => {
            if (selection === 'View Dependency Report') {
                showInstallationInstructions(results);
            } else if (selection === 'Install Missing Dependencies') {
                // Show quick pick menu for actions
                vscode.window.showQuickPick([
                    {
                        label: '$(info) Show Installation Instructions',
                        description: 'Get help installing missing dependencies',
                        action: 'instructions'
                    },
                    {
                        label: '$(refresh) Re-check Dependencies',
                        description: 'Run dependency check again',
                        action: 'recheck'
                    }
                ], {
                    placeHolder: 'Choose an action to resolve dependency issues',
                    ignoreFocusOut: true
                }).then(quickPickSelection => {
                    if (quickPickSelection?.action === 'instructions') {
                        showInstallationInstructions(results);
                    } else if (quickPickSelection?.action === 'recheck') {
                        // Re-run check
                        runDependencyCheck().then(showDependencyStatus, error => {
                            showErrorFromException(error, 'Dependency check failed');
                        });
                    }
                });
            }
        });
    }
}

export function showInstallationInstructions(results: DependencyCheckResults): void {
    const { claude, python, wrapper, ngrok } = results;
    
    let instructions = '# OpenCode Autopilot - Dependency Installation Guide\n\n';
    
    // Show status for each dependency
    if (claude.available) {
        instructions += `${DebugEmojis.SUCCESS} OpenCode CLI: ${claude.version}\n\n`;
    } else {
        instructions += `${DebugEmojis.ERROR} OpenCode CLI: Missing\n`;
        instructions += claude.installInstructions + '\n\n';
    }
    
    if (python.available) {
        instructions += `${DebugEmojis.SUCCESS} Python: ${python.version}\n\n`;
    } else {
        instructions += `${DebugEmojis.ERROR} Python: Missing\n`;
        instructions += python.installInstructions + '\n\n';
    }
    
    if (wrapper.available) {
        instructions += `${DebugEmojis.SUCCESS} PTY Wrapper: Ready\n\n`;
    } else {
        instructions += `${DebugEmojis.ERROR} PTY Wrapper: ${wrapper.error}\n`;
        instructions += wrapper.installInstructions + '\n\n';
    }
    
    if (ngrok.available) {
        instructions += `${DebugEmojis.SUCCESS} ngrok: ${ngrok.version}\n\n`;
    } else {
        instructions += `${DebugEmojis.ERROR} ngrok: Missing (optional)\n`;
        instructions += ngrok.installInstructions + '\n\n';
    }
    
    instructions += '\n---\n\n';
    instructions += '**After installing dependencies:**\n';
    instructions += '1. Restart VS Code\n';
    instructions += '2. Run the "Check Dependencies" command again\n';
    instructions += '3. All dependencies should show as available';
    
    // Show instructions in a new document
    vscode.workspace.openTextDocument({
        content: instructions,
        language: 'markdown'
    }).then(doc => {
        vscode.window.showTextDocument(doc);
    }, error => {
        showErrorFromException(error, 'Failed to show installation instructions');
        // Fallback to information message
        showInfo(instructions);
    });
}

function analyzeDependencyStatus(results: DependencyCheckResults): DependencyStatus {
    const { claude, python, wrapper, ngrok } = results;
    const issues: string[] = [];
    const successMessages: string[] = [];
    
    // Check critical dependencies
    let allCriticalReady = true;
    
    if (!claude.available) {
        issues.push(`${DebugEmojis.ERROR} OpenCode CLI: ${claude.error}`);
        allCriticalReady = false;
    }
    
    if (!python.available) {
        issues.push(`${DebugEmojis.ERROR} Python: ${python.error}`);
        allCriticalReady = false;
    }
    
    if (!wrapper.available) {
        issues.push(`${DebugEmojis.ERROR} PTY Wrapper: ${wrapper.error}`);
        allCriticalReady = false;
    }
    
    // ngrok is optional, don't fail if missing
    if (!ngrok.available) {
        issues.push(`${DebugEmojis.WARNING} ngrok: ${ngrok.error} (optional - web interface won't work)`);
    }
    
    if (allCriticalReady) {
        successMessages.push(
            `${DebugEmojis.SUCCESS} All dependencies ready! OpenCode: ${claude.version}, Python: ${python.version}, ngrok: ${ngrok.version || 'not available'}`
        );
    }
    
    return {
        allReady: allCriticalReady,
        issues,
        successMessages
    };
}

// Import here to avoid circular dependency
async function runDependencyCheck(): Promise<DependencyCheckResults> {
    const { runDependencyCheck: runCheck } = await import('./index');
    return runCheck();
}