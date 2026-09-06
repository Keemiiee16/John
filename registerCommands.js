import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commands } from "./commands.js";

export async function registerCommands() {
  try {
    const rest = new REST({ version: "10" }).setToken(config.discordToken);
    const body = commands.map((command) => command.data.toJSON());

    const subcommandCount = body.reduce((total, command) => {
      const options = command.options || [];
      for (const option of options) {
        // Discord option type 1 = subcommand, 2 = subcommand group.
        if (option.type === 1) total += 1;
        if (option.type === 2) total += (option.options || []).length;
      }
      return total;
    }, 0);

    console.log(
      `Registering ${body.length} global parent command(s) with ${subcommandCount} NPC action(s)...`
    );

    await rest.put(
      Routes.applicationCommands(config.clientId),
      { body }
    );

    console.log(
      `Successfully registered ${body.length} global parent command(s) with ${subcommandCount} NPC action(s).`
    );
  } catch (error) {
    console.error("Global command registration failed:", error);
    throw error;
  }
}

if (process.argv[1]?.endsWith("registerCommands.js")) {
  registerCommands().catch((error) => {
    console.error("Command registration failed:", error);
    process.exit(1);
  });
}
