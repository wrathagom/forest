import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

export function makeTmpRepo(name = "forest-test"): string {
  const dir = mkdtempSync(join(tmpdir(), `${name}-`));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e" };
  execSync("git init -q -b main", { cwd: dir, env });
  return dir;
}

export function gitCommit(dir: string, file: string, content: string, message: string) {
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e" };
  const path = join(dir, file);
  mkdirSync(join(dir, ".forest-mk"), { recursive: true });
  writeFileSync(path, content);
  execSync(`git add ${JSON.stringify(file)}`, { cwd: dir, env });
  execSync(`git commit -q -m ${JSON.stringify(message)}`, { cwd: dir, env });
}

export function touch(dir: string, file: string, mtimeSeconds: number) {
  const path = join(dir, file);
  utimesSync(path, mtimeSeconds, mtimeSeconds);
}
