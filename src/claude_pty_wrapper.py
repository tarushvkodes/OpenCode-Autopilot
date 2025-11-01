#!/usr/bin/env python3
import pty
import os
import sys
import select
import subprocess
import fcntl
import platform

def get_opencode_command():
    """Get the appropriate command to run OpenCode CLI. On Windows, always use WSL since PTY requires Unix environment."""
    if platform.system() == 'Windows':
        # On Windows, we must use WSL because PTY functionality requires Unix-like system calls
        # that are not available on Windows (pty, select, fcntl modules)
        return ['wsl', 'opencode']
    else:
        # For non-Windows platforms, use direct command
        return ['opencode']

def main():
    # Parse command line arguments
    skip_permissions = '--skip-permissions' in sys.argv
    
    # Spawn OpenCode with a proper PTY
    master, slave = pty.openpty()
    
    # Start OpenCode process with the slave PTY as its controlling terminal
    opencode_args = get_opencode_command()
    if skip_permissions:
        opencode_args.append('--dangerously-skip-permissions')
    
    opencode_process = subprocess.Popen(
        opencode_args,
        stdin=slave,
        stdout=slave,
        stderr=slave,
        close_fds=True,
        preexec_fn=os.setsid if platform.system() != 'Windows' else None
    )
    
    # Close the slave end in the parent process
    os.close(slave)
    
    # Set stdin to non-blocking mode
    stdin_flags = fcntl.fcntl(sys.stdin.fileno(), fcntl.F_GETFL)
    fcntl.fcntl(sys.stdin.fileno(), fcntl.F_SETFL, stdin_flags | os.O_NONBLOCK)
    
    try:
        while opencode_process.poll() is None:
            # Use select to handle both reading from master and stdin
            ready, _, _ = select.select([master, sys.stdin], [], [])
            
            if master in ready:
                try:
                    # Read from OpenCode and write to stdout
                    data = os.read(master, 1024)
                    if data:
                        sys.stdout.buffer.write(data)
                        sys.stdout.buffer.flush()
                except OSError:
                    break
            
            if sys.stdin in ready:
                try:
                    # Read from stdin and write to OpenCode
                    # Read more data at once for better performance
                    data = sys.stdin.buffer.read(1024)
                    if data:
                        # Debug: print what we're sending to OpenCode
                        # Use stderr for debug output to avoid interfering with stdout data flow
                        # between the PTY and OpenCode - stdout is reserved for actual program output
                        sys.stderr.write(f"[PTY] Sending to OpenCode: {repr(data)}\n")
                        sys.stderr.flush()
                        os.write(master, data)
                except (OSError, BlockingIOError):
                    break
                    
    except KeyboardInterrupt:
        pass
    finally:
        # Clean up
        opencode_process.terminate()
        opencode_process.wait()
        os.close(master)

if __name__ == '__main__':
    main() 