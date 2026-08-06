export interface CommandContribution {
  id: string;
  title(): string;
  run(): void;
  palette?: boolean;
}

export interface CommandRegistry {
  register(command: CommandContribution): () => void;
  commands(): CommandContribution[];
  execute(id: string): void;
  dispose(): void;
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, CommandContribution>();
  let disposed = false;
  const assertActive = () => {
    if (disposed) throw new Error("Command registry is disposed");
  };

  return {
    register(command) {
      assertActive();
      if (commands.has(command.id)) throw new Error(`Duplicate command: ${command.id}`);
      commands.set(command.id, command);
      return () => {
        if (commands.get(command.id) === command) commands.delete(command.id);
      };
    },
    commands() {
      assertActive();
      return [...commands.values()];
    },
    execute(id) {
      assertActive();
      const command = commands.get(id);
      if (!command) throw new Error(`Unknown command: ${id}`);
      command.run();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      commands.clear();
    },
  };
}
