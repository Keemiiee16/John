import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";

export async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!token || !clientId) {
    throw new Error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID for command registration.");
  }

  const rest = new REST({ version: "10" }).setToken(token);

  if (process.env.GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(clientId, process.env.GUILD_ID),
      { body: commands }
    );
    console.log(`Registered ${commands.length} guild John commands.`);
    return;
  }

  await rest.put(
    Routes.applicationCommands(clientId),
    { body: commands }
  );
  console.log(`Registered ${commands.length} global John commands.`);
}
