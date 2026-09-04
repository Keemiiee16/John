import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";

export async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.GUILD_ID;

  if (!token) throw new Error("Missing DISCORD_TOKEN");
  if (!clientId) throw new Error("Missing DISCORD_CLIENT_ID");

  const rest = new REST({ version: "10" }).setToken(token);

  if (guildId) {
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );
    console.log(`Registered ${commands.length} John commands to guild ${guildId}.`);
  } else {
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands }
    );
    console.log(`Registered ${commands.length} global John commands.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await registerCommands();
}
