/**
 * Individual dependency checker functions
 */
import { spawn, spawnSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { DependencyCheckResult, DependencyError } from './types';
import { wrapCommandForWSL } from '../../utils/wsl-helper';

export async function checkClaudeInstallation(): Promise<DependencyCheckResult> {
    // For Windows, try PowerShell first as a fallback method
    if (process.platform === 'win32') {
        return await checkOpenCodeInstallationWindows();
    }
    
    // For non-Windows platforms, use the original method
    return await checkOpenCodeInstallationGeneric();
}

async function checkOpenCodeInstallationWindows(): Promise<DependencyCheckResult> {
    // On Windows, we must use WSL because PTY functionality requires Unix-like system calls
    // Check if WSL is available first
    try {
        const { error: wslError, status: wslStatus } = spawnSync('wsl', ['--status'], {
            stdio: 'pipe',
            encoding: 'utf8',
            timeout: 3000
        });

        if (wslError || wslStatus !== 0) {
            return {
                available: false,
                error: 'WSL is required for OpenCode Autopilot on Windows but is not available or not properly configured',
                installInstructions: `WSL Installation Required:
1. Install WSL: wsl --install
2. Restart your computer
3. Install OpenCode CLI inside WSL
4. Verify: wsl opencode --version

WSL is required because the extension uses PTY functionality that requires Unix-like system calls.`
            };
        }
    } catch (error) {
        return {
            available: false,
            error: 'WSL is required for OpenCode Autopilot on Windows but is not available',
            installInstructions: `WSL Installation Required:
1. Install WSL: wsl --install
2. Restart your computer
3. Install OpenCode CLI inside WSL
4. Verify: wsl opencode --version

WSL is required because the extension uses PTY functionality that requires Unix-like system calls.`
        };
    }
    
    // Now check if OpenCode is available in WSL
    try {
        const { error, status, stdout, stderr } = spawnSync('wsl', ['opencode', '--version'], {
            stdio: 'pipe',
            encoding: 'utf8',
            timeout: 5000
        });

        if (error) {
            return {
                available: false,
                error: `WSL is available but OpenCode CLI is not installed in WSL: ${error.message}`,
                installInstructions: getOpenCodeInstallInstructions()
            };
        }

        if (status === 0 && stdout?.trim()) {
            return {
                available: true,
                version: stdout.trim(),
                path: 'opencode (via WSL)'
            };
        } else {
            return {
                available: false,
                error: `OpenCode CLI not found in WSL: ${stderr?.trim() || 'returned empty version'}`,
                installInstructions: getOpenCodeInstallInstructions()
            };
        }
    } catch (error) {
        return {
            available: false,
            error: `Failed to run opencode command in WSL: ${error instanceof Error ? error.message : 'Unknown error'}`,
            installInstructions: getOpenCodeInstallInstructions()
        };
    }
}

async function checkOpenCodeInstallationGeneric(): Promise<DependencyCheckResult> {
    try {
        const { error, status, stdout, stderr } = spawnSync('opencode', ['--version'], {
            stdio: 'pipe',
            encoding: 'utf8',
            timeout: 5000
        });

        if (error) {
            return {
                available: false,
                error: `Failed to run opencode command: ${error.message}`,
                installInstructions: getOpenCodeInstallInstructions()
            };
        }

        if (status === 0 && stdout?.trim()) {
            return {
                available: true,
                version: stdout.trim(),
                path: 'opencode'
            };
        } else {
            return {
                available: false,
                error: stderr?.trim() || 'OpenCode CLI not found or returned empty version',
                installInstructions: getOpenCodeInstallInstructions()
            };
        }
    } catch (error) {
        return {
            available: false,
            error: `Failed to run opencode command: ${error instanceof Error ? error.message : 'Unknown error'}`,
            installInstructions: getOpenCodeInstallInstructions()
        };
    }
}

export async function checkPythonInstallation(): Promise<DependencyCheckResult> {
    // Try different Python commands in order of preference
    // On Windows, try 'python3' first (via WSL), then 'python' (via WSL)
    // On other platforms, try 'python3' first, then 'python'
    const pythonCommands = process.platform === 'win32' 
        ? ['python3', 'python'] 
        : ['python3', 'python'];
    
    const triedCommands: string[] = [];
    
    for (const pythonCommand of pythonCommands) {
        triedCommands.push(pythonCommand);
        try {
            const { command, args } = wrapCommandForWSL(pythonCommand, ['--version']);
            const { error, status } = spawnSync(command, args, { stdio: 'pipe' });
            
            if (error) {
                // Command not found or failed to execute
                continue;
            }
            
            if (status !== 0) {
                // Command executed but returned non-zero status
                continue;
            }
            
            // Command succeeded, now verify minimum Python version (3.9+)
            const versionCheck = await verifyPythonVersion(pythonCommand);
            if (versionCheck.valid) {
                return {
                    available: true,
                    version: versionCheck.version,
                    path: process.platform === 'win32' ? `${pythonCommand} (via WSL)` : pythonCommand
                };
            } else {
                return {
                    available: false,
                    error: `Python version ${versionCheck.version} is too old. Minimum required: 3.9`,
                    installInstructions: getPythonInstallInstructions()
                };
            }
        } catch (error) {
            // Continue to next python command
            continue;
        }
    }
    
    // If we get here, none of the Python commands worked
    const errorMessage = `Could not locate Python interpreter (tried ${triedCommands.join(', ')}). Please install Python 3.9+ and restart VS Code.`;
    throw new DependencyError(errorMessage);
}

export async function checkPtyWrapperAvailability(): Promise<DependencyCheckResult> {
    try {
        // Import extensionContext from global state
        const { extensionContext } = await import('../../core/state');

        // Use extension context to get the correct path
        const wrapperPath = extensionContext
            ? path.join(extensionContext.extensionPath, 'out', 'claude', 'session', 'claude_pty_wrapper.py')
            : path.join(__dirname, '../../claude/session/claude_pty_wrapper.py');
        
        // Check if the wrapper file exists
        if (!fs.existsSync(wrapperPath)) {
            return {
                available: false,
                error: `PTY wrapper not found at expected path: ${wrapperPath}`,
                installInstructions: 'The PTY wrapper should be included with the extension. Try reinstalling the extension.'
            };
        }
        
        // Check if the file is readable
        try {
            fs.accessSync(wrapperPath, fs.constants.R_OK);
            return {
                available: true,
                version: 'Ready',
                path: wrapperPath
            };
        } catch (accessError) {
            return {
                available: false,
                error: `PTY wrapper exists but is not readable: ${accessError}`,
                installInstructions: 'Check file permissions on the PTY wrapper file.'
            };
        }
    } catch (error) {
        return {
            available: false,
            error: `Error checking PTY wrapper: ${error}`,
            installInstructions: 'Try reinstalling the extension to restore the PTY wrapper.'
        };
    }
}

export async function checkNgrokInstallation(): Promise<DependencyCheckResult> {
    const result = await checkCommand('ngrok', ['version']);
    if (!result.available) {
        result.installInstructions = getNgrokInstallInstructions();
    }
    return result;
}

async function verifyPythonVersion(pythonCommand: string): Promise<{valid: boolean; version: string}> {
    try {
        const { command, args } = wrapCommandForWSL(pythonCommand, ['--version']);
        const { error, status, stdout, stderr } = spawnSync(command, args, { 
            stdio: 'pipe',
            encoding: 'utf8'
        });

        if (error || status !== 0) {
            return { valid: false, version: 'unknown' };
        }

        // Parse version from output like "Python 3.9.7"
        const versionOutput = stdout || stderr || '';
        const versionMatch = versionOutput.match(/Python (\d+\.\d+\.\d+)/);
        
        if (versionMatch) {
            const version = versionMatch[1];
            const [major, minor] = version.split('.').map(Number);
            
            // Check if version is 3.9 or higher
            const isValid = major > 3 || (major === 3 && minor >= 9);
            return { valid: isValid, version };
        } else {
            return { valid: false, version: versionOutput.trim() };
        }
    } catch (error) {
        return { valid: false, version: 'unknown' };
    }
}

async function checkCommand(command: string, args: string[]): Promise<DependencyCheckResult> {
    try {
        const { command: wrappedCommand, args: wrappedArgs } = wrapCommandForWSL(command, args);
        const { error, status, stdout, stderr } = spawnSync(wrappedCommand, wrappedArgs, {
            stdio: 'pipe',
            encoding: 'utf8',
            timeout: 10000
        });

        if (error) {
            return {
                available: false,
                error: `Failed to run ${command}: ${error.message}`
            };
        }

        if (status === 0) {
            const output = stdout || stderr;
            const version = output.trim();
            
            return {
                available: true,
                version,
                path: process.platform === 'win32' ? `${command} (via WSL)` : command
            };
        } else {
            return {
                available: false,
                error: stderr?.trim() || `Command failed: ${command}`
            };
        }
    } catch (error) {
        return {
            available: false,
            error: `Failed to run ${command}: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
    }
}

function getOpenCodeInstallInstructions(): string {
    const platform = os.platform();
    
    switch (platform) {
        case 'darwin': // macOS
            return `OpenCode CLI Installation (macOS):
1. Install via npm: npm install -g @opencode/cli
2. Or visit: https://opencode.ai
3. After installation, restart VS Code
4. Verify installation: opencode --version`;
            
        case 'win32': // Windows
            return `OpenCode CLI Installation (Windows - WSL Required):
IMPORTANT: WSL is required for OpenCode Autopilot on Windows because it uses PTY functionality that requires Unix-like system calls.

1. Install WSL (if not already installed):
   - Run: wsl --install
   - Restart your computer

2. Install OpenCode CLI inside WSL:
   - Open WSL terminal (Ubuntu/your preferred distro)
   - Install: npm install -g @opencode/cli
   - Verify: opencode --version (inside WSL)
   - Run opencode and set up your API key if needed

3. Verify from Windows:
   - Test: wsl opencode --version

The extension will automatically use WSL to run OpenCode on Windows.`;
            
        case 'linux': // Linux
            return `OpenCode CLI Installation (Linux):
1. Install via npm: npm install -g @opencode/cli
2. Or visit: https://opencode.ai
3. Restart VS Code
4. Verify installation: opencode --version`;
            
        default:
            return `OpenCode CLI Installation:
1. Visit: https://opencode.ai
2. Install via npm: npm install -g @opencode/cli
3. Follow platform-specific installation instructions
4. Restart VS Code
5. Verify installation: opencode --version`;
    }
}

function getPythonInstallInstructions(): string {
    const platform = os.platform();
    
    switch (platform) {
        case 'darwin': // macOS
            return `Python Installation (macOS):
1. Install via Homebrew: brew install python3
2. Or download from: https://python.org/downloads
3. Restart VS Code
4. Verify installation: python3 --version`;
            
        case 'win32': // Windows  
            return `Python Installation (Windows - WSL Required):
IMPORTANT: WSL is required for Claude Autopilot on Windows because it uses PTY functionality that requires Unix-like system calls.

1. Install WSL (if not already installed):
   - Run: wsl --install
   - Restart your computer

2. Install Python inside WSL:
   - Open WSL terminal (Ubuntu/your preferred distro)
   - Update package list: sudo apt update
   - Install Python: sudo apt install python3 python3-pip
   - Verify: python3 --version (inside WSL)

3. Verify from Windows:
   - Test: wsl python3 --version

The extension will automatically use WSL to run Python on Windows.`;
            
        case 'linux': // Linux
            return `Python Installation (Linux):
1. Ubuntu/Debian: sudo apt update && sudo apt install python3
2. CentOS/RHEL: sudo yum install python3
3. Restart VS Code
4. Verify installation: python3 --version`;
            
        default:
            return `Python Installation:
1. Visit: https://python.org/downloads
2. Download Python 3.9 or higher
3. Follow platform-specific installation instructions
4. Restart VS Code
5. Verify installation: python3 --version`;
    }
}

function getNgrokInstallInstructions(): string {
    const platform = os.platform();
    
    switch (platform) {
        case 'darwin': // macOS
            return `ngrok Installation (macOS):
1. Install via Homebrew: brew install ngrok/ngrok/ngrok
2. Or download from: https://ngrok.com/download
3. Create account at: https://dashboard.ngrok.com/signup
4. Set auth token: ngrok authtoken <your-token>
5. Restart VS Code
6. Verify installation: ngrok version`;
            
        case 'win32': // Windows
            return `ngrok Installation (Windows - WSL Required):
IMPORTANT: WSL is required for Claude Autopilot on Windows because it uses PTY functionality that requires Unix-like system calls.

1. Install WSL (if not already installed):
   - Run: wsl --install
   - Restart your computer

2. Install ngrok inside WSL:
   - Open WSL terminal (Ubuntu/your preferred distro)
   - Download: curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list && sudo apt update && sudo apt install ngrok
   - Or download manually from: https://ngrok.com/download
   - Create account at: https://dashboard.ngrok.com/signup
   - Set auth token: ngrok authtoken <your-token>
   - Verify: ngrok version (inside WSL)

3. Verify from Windows:
   - Test: wsl ngrok version

The extension will automatically use WSL to run ngrok on Windows.`;
            
        case 'linux': // Linux
            return `ngrok Installation (Linux):
1. Download from: https://ngrok.com/download
2. Extract: tar -xzf ngrok-v3-stable-linux-amd64.tgz
3. Move to PATH: sudo mv ngrok /usr/local/bin/
4. Create account at: https://dashboard.ngrok.com/signup
5. Set auth token: ngrok authtoken <your-token>
6. Restart VS Code
7. Verify installation: ngrok version`;
            
        default:
            return `ngrok Installation:
1. Visit: https://ngrok.com/download
2. Download for your platform
3. Follow platform-specific installation instructions
4. Create account at: https://dashboard.ngrok.com/signup
5. Set auth token: ngrok authtoken <your-token>
6. Restart VS Code
7. Verify installation: ngrok version`;
    }
}