import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Partials,
  MessageFlags,
} from "discord.js";

import { config } from "./config.js";
import {
  testSupabaseConnection,
  ensureGuildSettings,
} from "./db.js";
import { commands } from "./commands.js";
import { registerCommands } from "./registerCommands.js";
import { startHealthServer } from "./health.js";
import { handleNpcComponent, syncWorldChannel } from "./npc.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildWebhooks,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
  ],
});

client.commands = new Collection();

for (const command of commands) {
  client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`LifeLine logged in as ${readyClient.user.tag}.`);

  try {
    await testSupabaseConnection();
    console.log("Supabase connected.");

    for (const guild of readyClient.guilds.cache.values()) {
      await ensureGuildSettings(guild.id);
      console.log(`Guild settings ready: ${guild.name} (${guild.id})`);
    }
  } catch (error) {
    console.error(error);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  try {
    await ensureGuildSettings(guild.id);
    console.log(`Initialized settings for new guild: ${guild.name}`);
  } catch (error) {
    console.error("Could not initialize new guild:", error);
  }
});

client.on(Events.ChannelCreate, async (channel) => {
  try {
    if (!channel.guild) return;

    await syncWorldChannel(channel.guild, channel, {
      notifyUnknown: true,
    });
  } catch (error) {
    console.error("Could not inspect new LifeLine world channel:", error);
  }
});

client.on(
  Events.ChannelUpdate,
  async (_oldChannel, newChannel) => {
    try {
      if (!newChannel.guild) return;

      await syncWorldChannel(
        newChannel.guild,
        newChannel,
        { notifyUnknown: true }
      );
    } catch (error) {
      console.error(
        "Could not refresh updated LifeLine world channel:",
        error
      );
    }
  }
);

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      return await command.execute(interaction);
    }

    if (
      interaction.isButton() ||
      interaction.isModalSubmit() ||
      interaction.isStringSelectMenu() ||
      interaction.isChannelSelectMenu()
    ) {
      if (interaction.customId?.startsWith("npc_")) {
        const interactionAgeMs =
          Date.now() - interaction.createdTimestamp;

        console.log(
          `NPC interaction ${interaction.customId} received after ${interactionAgeMs}ms`
        );

        // World Scan/Review can do heavier work, so acknowledge the
        // button immediately before any routing/database/channel work.
        if (
          interaction.isButton() &&
          (
            interaction.customId === "npc_world:scan" ||
            interaction.customId === "npc_world:review"
          )
        ) {
          await interaction.deferReply({
            flags: MessageFlags.Ephemeral,
          });
        }

        return await handleNpcComponent(interaction);
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (error?.code === 10062 || error?.code === 40060) {
      console.error(
        "Discord interaction expired or was already acknowledged; skipping fallback reply."
      );
      return;
    }

    const message =
      "Something went wrong while running that LifeLine action. Check the Render logs for the exact error.";

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: message,
          embeds: [],
          components: [],
        });
      } else {
        await interaction.reply({
          content: message,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (replyError) {
      console.error("Could not send fallback interaction response:", replyError);
    }
  }
});

async function boot() {
  startHealthServer(config.port);
  await registerCommands();
  await client.login(config.discordToken);
}

boot().catch((error) => {
  console.error("LifeLine failed to start:", error);
  process.exit(1);
});
