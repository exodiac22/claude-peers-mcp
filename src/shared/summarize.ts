/**
 * Generate a deterministic summary of what a Claude Code instance is likely
 * working on, based on its working directory and git context.
 *
 * Pure git-based — no external API calls, no dependencies.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function gitOutput(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
    return stdout;
  } catch {
    return null;
  }
}

export async function generateSummary(context: {
  cwd: string;
  git_root: string | null;
  git_branch?: string | null;
  recent_files?: string[];
}): Promise<string | null> {
  const parts: string[] = [];

  // Extract project name from git root or cwd
  const dir = context.git_root || context.cwd;
  const projectName = dir.split("/").pop() || dir;

  // Branch info
  if (context.git_branch && context.git_branch !== "main" && context.git_branch !== "master") {
    parts.push(`On branch ${context.git_branch}`);
  }

  // Recent file activity
  if (context.recent_files && context.recent_files.length > 0) {
    const fileList = context.recent_files.slice(0, 3).join(", ");
    parts.push(`recently touched ${fileList}`);
  }

  if (parts.length === 0) {
    return `Working in ${projectName}`;
  }

  return `[${projectName}:${context.git_branch || "main"}] ${parts.join(". ")}`;
}

/**
 * Get the current git branch name for a directory.
 */
export async function getGitBranch(cwd: string): Promise<string | null> {
  const text = await gitOutput(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return text === null ? null : text.trim();
}

/**
 * Get recently modified tracked files in the git repo.
 */
export async function getRecentFiles(
  cwd: string,
  limit = 10
): Promise<string[]> {
  try {
    // Get modified/staged files first
    const diffText = (await gitOutput(cwd, ["diff", "--name-only", "HEAD"])) ?? "";

    const files = diffText
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);

    if (files.length >= limit) {
      return files.slice(0, limit);
    }

    // Also get recently committed files
    const logText = (await gitOutput(cwd, ["log", "--oneline", "--name-only", "-5", "--format="])) ?? "";

    const logFiles = logText
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);

    const allFiles = [...new Set([...files, ...logFiles])];
    return allFiles.slice(0, limit);
  } catch {
    return [];
  }
}
