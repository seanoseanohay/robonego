import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type RoleName = "critic" | "judge" | "implementer";

export async function ensureStateDir(stateDir: string): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await mkdir(path.join(stateDir, "rounds"), { recursive: true });
}

export function roleMemoryPath(stateDir: string, role: RoleName): string {
  return path.join(stateDir, `${role}-memory.md`);
}

export async function loadRoleMemory(stateDir: string, role: RoleName): Promise<string> {
  try {
    return await readFile(roleMemoryPath(stateDir, role), "utf8");
  } catch {
    return "";
  }
}

export async function saveRoleMemory(stateDir: string, role: RoleName, memory: string): Promise<void> {
  await writeFile(roleMemoryPath(stateDir, role), memory.trim() + "\n", "utf8");
}

export async function saveRoundArtifact(stateDir: string, round: number, name: string, data: unknown): Promise<void> {
  const file = path.join(stateDir, "rounds", `round-${round}-${name}.json`);
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
}
