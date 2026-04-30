# JOHN BOT FULL CLEAN VERSION (HELP FIXED)

import os
import discord
from discord.ext import commands
from dotenv import load_dotenv

load_dotenv()
TOKEN = os.getenv("DISCORD_TOKEN")

intents = discord.Intents.all()

bot = commands.Bot(command_prefix="!", intents=intents, help_command=None)

# ======================
# HELP MENU (FIXED)
# ======================
@bot.command()
async def help(ctx):
    embed = discord.Embed(
        title="🤖 John Bot Commands",
        description="Full command list",
        color=discord.Color.blue()
    )

    embed.add_field(
        name="👤 Characters",
        value="""!createchar <name> <trigger>
!createcharpfp <name> <trigger> <url>
!setavatar <name>
!chars | !switchchar | !whoami | !deletechar""",
        inline=False
    )

    embed.add_field(
        name="💰 Economy",
        value="""!balance | !deposit | !withdraw
!give | !daily""",
        inline=False
    )

    embed.add_field(
        name="🛒 Store",
        value="""!shop | !buy | !inventory""",
        inline=False
    )

    embed.add_field(
        name="💼 Jobs",
        value="""!jobs | !setjob | !switchjob | !work""",
        inline=False
    )

    embed.add_field(
        name="🚗 Cars",
        value="""!cars | !buycar | !garage | !drive""",
        inline=False
    )

    embed.add_field(
        name="🏠 Housing",
        value="""!houses | !buyhouse | !myhouses""",
        inline=False
    )

    embed.add_field(
        name="⛽ Gas",
        value="""!gas | !fuel | !buygas""",
        inline=False
    )

    embed.add_field(
        name="🎰 Games",
        value="""!coinflip | !slots""",
        inline=False
    )

    embed.add_field(
        name="✨ Custom",
        value="""!setreply | !replies""",
        inline=False
    )

    embed.set_footer(text="John • RP Economy Bot")

    await ctx.send(embed=embed)


# ======================
# BASIC TEST COMMAND
# ======================
@bot.command()
async def ping(ctx):
    await ctx.send("John is online ✅")


bot.run(TOKEN)
