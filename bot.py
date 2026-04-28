import os
import random
from datetime import datetime, timezone

import discord
from discord.ext import commands
from dotenv import load_dotenv
import aiosqlite

print("JOHN FULL RESET VERSION LOADED")

load_dotenv()
TOKEN = os.getenv("DISCORD_TOKEN")

if not TOKEN:
    raise SystemExit("DISCORD_TOKEN not set in .env")

intents = discord.Intents.default()
intents.message_content = True
intents.members = True

bot = commands.Bot(command_prefix="!", intents=intents, help_command=None)

DB = "database.db"

# Set this to True later if you want only admins to manage store/jobs/gas.
ADMIN_ONLY_MANAGEMENT = False


# --------------------------------------------------
# DATABASE
# --------------------------------------------------
async def init_db():
    async with aiosqlite.connect(DB) as db:
        await db.execute("""
        CREATE TABLE IF NOT EXISTS characters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            avatar_url TEXT DEFAULT '',
            wallet INTEGER DEFAULT 500,
            bank INTEGER DEFAULT 1000,
            fuel INTEGER DEFAULT 0,
            job_name TEXT DEFAULT '',
            UNIQUE(owner_user_id, name)
        )
        """)

        await db.execute("""
        CREATE TABLE IF NOT EXISTS active_characters (
            user_id INTEGER PRIMARY KEY,
            character_id INTEGER NOT NULL
        )
        """)

        await db.execute("""
        CREATE TABLE IF NOT EXISTS shop_items (
            item_name TEXT PRIMARY KEY,
            price INTEGER NOT NULL,
            description TEXT DEFAULT ''
        )
        """)

        await db.execute("""
        CREATE TABLE IF NOT EXISTS inventory (
            character_id INTEGER NOT NULL,
            item_name TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (character_id, item_name)
        )
        """)

        await db.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            job_name TEXT PRIMARY KEY,
            min_pay INTEGER NOT NULL,
            max_pay INTEGER NOT NULL
        )
        """)

        await db.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT NOT NULL
        )
        """)

        await db.execute("""
        CREATE TABLE IF NOT EXISTS cooldowns (
            character_id INTEGER NOT NULL,
            command_name TEXT NOT NULL,
            last_used TEXT NOT NULL,
            PRIMARY KEY (character_id, command_name)
        )
        """)

        await db.commit()

    await seed_defaults()


async def seed_defaults():
    default_items = [
        ("water", 5, "A bottle of water"),
        ("chips", 8, "A bag of chips"),
        ("phone", 250, "A basic cellphone"),
        ("burger", 15, "A quick meal"),
        ("bandage", 20, "Useful for injuries"),
    ]

    default_jobs = [
        ("cashier", 40, 80),
        ("mechanic", 70, 140),
        ("delivery", 50, 100),
        ("bartender", 60, 120),
        ("florist", 35, 75),
    ]

    default_settings = {
        "starter_wallet": "500",
        "starter_bank": "1000",
        "gas_price": "5",
        "daily_min": "150",
        "daily_max": "300",
        "work_cooldown": "1800",
        "daily_cooldown": "86400",
    }

    async with aiosqlite.connect(DB) as db:
        for item_name, price, description in default_items:
            await db.execute("""
                INSERT INTO shop_items (item_name, price, description)
                VALUES (?, ?, ?)
                ON CONFLICT(item_name) DO NOTHING
            """, (item_name, price, description))

        for job_name, min_pay, max_pay in default_jobs:
            await db.execute("""
                INSERT INTO jobs (job_name, min_pay, max_pay)
                VALUES (?, ?, ?)
                ON CONFLICT(job_name) DO NOTHING
            """, (job_name, min_pay, max_pay))

        for key, value in default_settings.items():
            await db.execute("""
                INSERT INTO settings (setting_key, setting_value)
                VALUES (?, ?)
                ON CONFLICT(setting_key) DO NOTHING
            """, (key, value))

        await db.commit()


# --------------------------------------------------
# HELPERS
# --------------------------------------------------
def can_manage(ctx):
    if not ADMIN_ONLY_MANAGEMENT:
        return True
    return ctx.author.guild_permissions.administrator


def fmt_seconds(seconds: int) -> str:
    minutes, sec = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours > 0:
        return f"{hours}h {minutes}m {sec}s"
    if minutes > 0:
        return f"{minutes}m {sec}s"
    return f"{sec}s"


async def get_setting(key: str, default: str | None = None) -> str:
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute(
            "SELECT setting_value FROM settings WHERE setting_key = ?",
            (key,),
        )
        row = await cur.fetchone()
    return row[0] if row else default


async def set_setting(key: str, value: str):
    async with aiosqlite.connect(DB) as db:
        await db.execute("""
            INSERT INTO settings (setting_key, setting_value)
            VALUES (?, ?)
            ON CONFLICT(setting_key)
            DO UPDATE SET setting_value = excluded.setting_value
        """, (key, str(value)))
        await db.commit()


async def get_character_by_name_for_owner(user_id: int, name: str):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT id, owner_user_id, name, avatar_url, wallet, bank, fuel, job_name
            FROM characters
            WHERE owner_user_id = ? AND lower(name) = lower(?)
        """, (user_id, name))
        return await cur.fetchone()


async def get_any_character_by_name(name: str):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT id, owner_user_id, name, avatar_url, wallet, bank, fuel, job_name
            FROM characters
            WHERE lower(name) = lower(?)
        """, (name,))
        return await cur.fetchone()


async def get_active_character(user_id: int):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT c.id, c.owner_user_id, c.name, c.avatar_url, c.wallet, c.bank, c.fuel, c.job_name
            FROM active_characters ac
            JOIN characters c ON c.id = ac.character_id
            WHERE ac.user_id = ?
        """, (user_id,))
        return await cur.fetchone()


async def require_active_character(ctx):
    row = await get_active_character(ctx.author.id)
    if not row:
        await ctx.send("You need an active character first. Use `!createchar <name>`.")
        return None
    return row


async def create_character(user_id: int, name: str, avatar_url: str = ""):
    starter_wallet = int(await get_setting("starter_wallet", "500"))
    starter_bank = int(await get_setting("starter_bank", "1000"))

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            INSERT INTO characters (owner_user_id, name, avatar_url, wallet, bank, fuel, job_name)
            VALUES (?, ?, ?, ?, ?, 0, '')
        """, (user_id, name, avatar_url, starter_wallet, starter_bank))
        char_id = cur.lastrowid

        await db.execute("""
            INSERT INTO active_characters (user_id, character_id)
            VALUES (?, ?)
            ON CONFLICT(user_id)
            DO UPDATE SET character_id = excluded.character_id
        """, (user_id, char_id))

        await db.commit()

    return char_id


async def switch_character(user_id: int, character_id: int):
    async with aiosqlite.connect(DB) as db:
        await db.execute("""
            INSERT INTO active_characters (user_id, character_id)
            VALUES (?, ?)
            ON CONFLICT(user_id)
            DO UPDATE SET character_id = excluded.character_id
        """, (user_id, character_id))
        await db.commit()


async def add_wallet(character_id: int, amount: int):
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "UPDATE characters SET wallet = wallet + ? WHERE id = ?",
            (amount, character_id),
        )
        await db.commit()


async def add_bank(character_id: int, amount: int):
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "UPDATE characters SET bank = bank + ? WHERE id = ?",
            (amount, character_id),
        )
        await db.commit()


async def set_fuel_amount(character_id: int, amount: int):
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "UPDATE characters SET fuel = ? WHERE id = ?",
            (amount, character_id),
        )
        await db.commit()


async def set_job_name(character_id: int, job_name: str):
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "UPDATE characters SET job_name = ? WHERE id = ?",
            (job_name, character_id),
        )
        await db.commit()


async def get_all_jobs():
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT job_name, min_pay, max_pay
            FROM jobs
            ORDER BY job_name ASC
        """)
        return await cur.fetchall()


async def get_job(job_name: str):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT job_name, min_pay, max_pay
            FROM jobs
            WHERE lower(job_name) = lower(?)
        """, (job_name,))
        return await cur.fetchone()


async def get_inventory_rows(character_id: int):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT item_name, quantity
            FROM inventory
            WHERE character_id = ? AND quantity > 0
            ORDER BY item_name ASC
        """, (character_id,))
        return await cur.fetchall()


async def cooldown_ready(character_id: int, command_name: str, seconds: int):
    now = datetime.now(timezone.utc)

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT last_used FROM cooldowns
            WHERE character_id = ? AND command_name = ?
        """, (character_id, command_name))
        row = await cur.fetchone()

    if row is None:
        return True, 0

    last_used = datetime.fromisoformat(row[0])
    elapsed = (now - last_used).total_seconds()

    if elapsed >= seconds:
        return True, 0

    return False, int(seconds - elapsed)


async def set_cooldown(character_id: int, command_name: str):
    now = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(DB) as db:
        await db.execute("""
            INSERT INTO cooldowns (character_id, command_name, last_used)
            VALUES (?, ?, ?)
            ON CONFLICT(character_id, command_name)
            DO UPDATE SET last_used = excluded.last_used
        """, (character_id, command_name, now))
        await db.commit()


# --------------------------------------------------
# TUPPER-STYLE PROXY
# --------------------------------------------------
async def get_or_create_proxy_webhook(channel: discord.TextChannel):
    hooks = await channel.webhooks()
    for hook in hooks:
        if hook.user == bot.user and hook.name == "John Proxy":
            return hook
    return await channel.create_webhook(name="John Proxy")


async def proxy_if_character_message(message: discord.Message):
    if ":" not in message.content:
        return False

    name_part, content_part = message.content.split(":", 1)
    char_name = name_part.strip()
    text = content_part.strip()

    if not char_name or not text:
        return False

    character = await get_character_by_name_for_owner(message.author.id, char_name)
    if not character:
        return False

    _, _, real_name, avatar_url, _, _, _, _ = character

    if not isinstance(message.channel, discord.TextChannel):
        return False

    try:
        webhook = await get_or_create_proxy_webhook(message.channel)
        await webhook.send(
            content=text,
            username=real_name,
            avatar_url=avatar_url if avatar_url else discord.utils.MISSING,
            allowed_mentions=discord.AllowedMentions.none(),
        )
        try:
            await message.delete()
        except discord.Forbidden:
            pass
        return True
    except discord.Forbidden:
        await message.channel.send("John needs **Manage Webhooks** in this channel.")
        return True


# --------------------------------------------------
# EVENTS
# --------------------------------------------------
@bot.event
async def on_ready():
    await init_db()
    print(f"Logged in as {bot.user} (ID: {bot.user.id})")


@bot.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return

    if message.content.startswith("!"):
        await bot.process_commands(message)
        return

    proxied = await proxy_if_character_message(message)
    if proxied:
        return

    await bot.process_commands(message)


# --------------------------------------------------
# HELP
# --------------------------------------------------
@bot.command()
async def help(ctx):
    await ctx.send(
        "**Characters**\n"
        "`!createchar <name>`\n"
        "`!createcharpfp <name> <avatar_url>`\n"
        "`!chars`\n"
        "`!switchchar <name>`\n"
        "`!whoami`\n\n"
        "**Jobs**\n"
        "`!jobs`\n"
        "`!setjob <job>`\n"
        "`!work`\n"
        "`!addjob <name> <min> <max>`\n"
        "`!setjobpay <name> <min> <max>`\n"
        "`!removejob <name>`\n\n"
        "**Store**\n"
        "`!shop`\n"
        "`!buy <item> [amount]`\n"
        "`!inventory`\n"
        "`!additem <name> <price> <description>`\n"
        "`!setprice <item> <price>`\n"
        "`!removeitem <item>`\n\n"
        "**Economy**\n"
        "`!balance`\n"
        "`!deposit <amount>`\n"
        "`!withdraw <amount>`\n"
        "`!daily`\n"
        "`!give <character> <amount>`\n\n"
        "**Gas**\n"
        "`!gas`\n"
        "`!setgas <price>`\n"
        "`!fuel`\n"
        "`!buygas <amount>`\n\n"
        "**Games**\n"
        "`!coinflip <amount> <heads/tails>`\n"
        "`!slots <amount>`\n\n"
        "**Proxy**\n"
        "`CharacterName: message`"
    )


# --------------------------------------------------
# CHARACTER COMMANDS
# --------------------------------------------------
@bot.command()
async def createchar(ctx, name: str):
    existing = await get_character_by_name_for_owner(ctx.author.id, name)
    if existing:
        return await ctx.send("You already have a character with that name.")

    await create_character(ctx.author.id, name)
    await ctx.send(f"Created character **{name}** and set them active.")


@bot.command()
async def createcharpfp(ctx, name: str, avatar_url: str):
    existing = await get_character_by_name_for_owner(ctx.author.id, name)
    if existing:
        return await ctx.send("You already have a character with that name.")

    await create_character(ctx.author.id, name, avatar_url)
    await ctx.send(f"Created character **{name}** with an avatar and set them active.")


@bot.command()
async def chars(ctx):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT id, name, wallet, bank, fuel, job_name
            FROM characters
            WHERE owner_user_id = ?
            ORDER BY name ASC
        """, (ctx.author.id,))
        rows = await cur.fetchall()

    if not rows:
        return await ctx.send("You don't have any characters yet.")

    active = await get_active_character(ctx.author.id)
    active_id = active[0] if active else None

    msg = "**Your characters:**\n"
    for char_id, name, wallet, bank, fuel, job_name in rows:
        marker = " ⭐" if char_id == active_id else ""
        msg += f"- {name}{marker} | Wallet ${wallet} | Bank ${bank} | Fuel {fuel} | Job {job_name or 'none'}\n"

    await ctx.send(msg)


@bot.command()
async def switchchar(ctx, name: str):
    character = await get_character_by_name_for_owner(ctx.author.id, name)
    if not character:
        return await ctx.send("You don't own a character with that name.")

    await switch_character(ctx.author.id, character[0])
    await ctx.send(f"Switched to **{character[2]}**.")


@bot.command()
async def whoami(ctx):
    active = await get_active_character(ctx.author.id)
    if not active:
        return await ctx.send("No active character.")
    await ctx.send(f"You are currently **{active[2]}**.")


# --------------------------------------------------
# ECONOMY
# --------------------------------------------------
@bot.command()
async def balance(ctx):
    active = await require_active_character(ctx)
    if not active:
        return
    _, _, name, _, wallet, bank, fuel, job_name = active
    await ctx.send(f"**{name}** — Wallet ${wallet} | Bank ${bank} | Fuel {fuel} | Job {job_name or 'none'}")


@bot.command()
async def deposit(ctx, amount: int):
    active = await require_active_character(ctx)
    if not active:
        return

    char_id, _, name, _, wallet, bank, fuel, _ = active

    if amount <= 0:
        return await ctx.send("Amount must be positive.")
    if wallet < amount:
        return await ctx.send("Not enough cash.")

    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "UPDATE characters SET wallet = wallet - ?, bank = bank + ? WHERE id = ?",
            (amount, amount, char_id),
        )
        await db.commit()

    await ctx.send(f"Deposited ${amount} for **{name}**.")


@bot.command()
async def withdraw(ctx, amount: int):
    active = await require_active_character(ctx)
    if not active:
        return

    char_id, _, name, _, wallet, bank, fuel, _ = active

    if amount <= 0:
        return await ctx.send("Amount must be positive.")
    if bank < amount:
        return await ctx.send("Not enough in bank.")

    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "UPDATE characters SET wallet = wallet + ?, bank = bank - ? WHERE id = ?",
            (amount, amount, char_id),
        )
        await db.commit()

    await ctx.send(f"Withdrew ${amount} for **{name}**.")


@bot.command()
async def give(ctx, target_character_name: str, amount: int):
    active = await require_active_character(ctx)
    if not active:
        return

    char_id, _, name, _, wallet, _, _, _ = active

    if amount <= 0:
        return await ctx.send("Amount must be positive.")
    if wallet < amount:
        return await ctx.send(f"**{name}** does not have enough cash.")

    target = await get_any_character_by_name(target_character_name)
    if not target:
        return await ctx.send("That character does not exist.")

    target_id = target[0]
    target_name = target[2]

    if target_id == char_id:
        return await ctx.send("You can't give money to yourself.")

    async with aiosqlite.connect(DB) as db:
        await db.execute("UPDATE characters SET wallet = wallet - ? WHERE id = ?", (amount, char_id))
        await db.execute("UPDATE characters SET wallet = wallet + ? WHERE id = ?", (amount, target_id))
        await db.commit()

    await ctx.send(f"**{name}** gave **${amount}** to **{target_name}**.")


@bot.command()
async def daily(ctx):
    active = await require_active_character(ctx)
    if not active:
        return

    char_id, _, name, _, _, _, _, _ = active
    cooldown = int(await get_setting("daily_cooldown", "86400"))
    ready, remaining = await cooldown_ready(char_id, "daily", cooldown)

    if not ready:
        return await ctx.send(f"**{name}** already claimed daily. Try again in {fmt_seconds(remaining)}.")

    daily_min = int(await get_setting("daily_min", "150"))
    daily_max = int(await get_setting("daily_max", "300"))
    payout = random.randint(daily_min, daily_max)

    await add_wallet(char_id, payout)
    await set_cooldown(char_id, "daily")

    await ctx.send(f"🎁 **{name}** got **${payout}** from daily.")


# --------------------------------------------------
# STORE
# --------------------------------------------------
@bot.command()
async def shop(ctx):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT item_name, price, description
            FROM shop_items
            ORDER BY item_name ASC
        """)
        rows = await cur.fetchall()

    if not rows:
        return await ctx.send("The shop is empty.")

    embed = discord.Embed(title="🛒 John's Shop", color=discord.Color.blue())
    for item_name, price, description in rows:
        embed.add_field(
            name=f"{item_name} - ${price}",
            value=description or "No description",
            inline=False,
        )
    await ctx.send(embed=embed)


@bot.command()
async def buy(ctx, item_name: str, amount: int = 1):
    active = await require_active_character(ctx)
    if not active:
        return

    char_id, _, name, _, wallet, _, _, _ = active
    item_name = item_name.lower()

    if amount <= 0:
        return await ctx.send("Amount must be positive.")

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute(
            "SELECT price FROM shop_items WHERE item_name = ?",
            (item_name,),
        )
        item = await cur.fetchone()

        if not item:
            return await ctx.send("That item is not in the shop.")

        price = item[0]
        total = price * amount

        if wallet < total:
            return await ctx.send(f"**{name}** needs ${total} but only has ${wallet}.")

        await db.execute(
            "UPDATE characters SET wallet = wallet - ? WHERE id = ?",
            (total, char_id),
        )

        await db.execute("""
            INSERT INTO inventory (character_id, item_name, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(character_id, item_name)
            DO UPDATE SET quantity = quantity + excluded.quantity
        """, (char_id, item_name, amount))

        await db.commit()

    await ctx.send(f"✅ **{name}** bought **{amount}x {item_name}** for **${total}**.")


@bot.command()
async def inventory(ctx):
    active = await require_active_character(ctx)
    if not active:
        return

    char_id, _, name, _, _, _, _, _ = active
    rows = await get_inventory_rows(char_id)

    if not rows:
        return await ctx.send(f"**{name}** has an empty inventory.")

    msg = f"**{name}'s inventory:**\n"
    for item_name, quantity in rows:
        msg += f"- {item_name}: {quantity}\n"

    await ctx.send(msg)


@bot.command()
async def additem(ctx, item_name: str, price: int, *, description: str = ""):
    if not can_manage(ctx):
        return await ctx.send("Admins only.")

    if price < 0:
        return await ctx.send("Price cannot be negative.")

    item_name = item_name.lower()

    async with aiosqlite.connect(DB) as db:
        await db.execute("""
            INSERT INTO shop_items (item_name, price, description)
            VALUES (?, ?, ?)
            ON CONFLICT(item_name) DO UPDATE
            SET price = excluded.price,
                description = excluded.description
        """, (item_name, price, description))
        await db.commit()

    await ctx.send(f"Added/updated **{item_name}** for **${price}**.")


@bot.command()
async def setprice(ctx, item_name: str, price: int):
    if not can_manage(ctx):
        return await ctx.send("Admins only.")

    if price < 0:
        return await ctx.send("Price cannot be negative.")

    item_name = item_name.lower()

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute(
            "UPDATE shop_items SET price = ? WHERE item_name = ?",
            (price, item_name),
        )
        await db.commit()

        if cur.rowcount == 0:
            return await ctx.send("That item doesn't exist.")

    await ctx.send(f"Updated **{item_name}** price to **${price}**.")


@bot.command()
async def removeitem(ctx, item_name: str):
    if not can_manage(ctx):
        return await ctx.send("Admins only.")

    item_name = item_name.lower()

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute(
            "DELETE FROM shop_items WHERE item_name = ?",
            (item_name,),
        )
        await db.commit()

        if cur.rowcount == 0:
            return await ctx.send("That item doesn't exist.")

    await ctx.send(f"Removed **{item_name}** from the shop.")


# --------------------------------------------------
# JOBS
# --------------------------------------------------
@bot.command()
async def jobs(ctx):
    rows = await get_all_jobs()
    if not rows:
        return await ctx.send("No jobs are set up.")

    msg = "**Available jobs:**\n"
    for job_name, min_pay, max_pay in rows:
        msg += f"- {job_name}: ${min_pay}-${max_pay}\n"
    await ctx.send(msg)


@bot.command()
async def setjob(ctx, job_name: str):
    active = await require_active_character(ctx)
    if not active:
        return

    job = await get_job(job_name)
    if not job:
        return await ctx.send("That job doesn't exist. Use `!jobs`.")

    await set_job_name(active[0], job[0])
    await ctx.send(f"**{active[2]}** is now a **{job[0]}**.")


@bot.command()
async def work(ctx):
    active = await require_active_character(ctx)
    if not active:
        return

    char_id, _, name, _, _, _, _, job_name = active

    if not job_name:
        return await ctx.send(f"**{name}** has no job yet. Use `!setjob <job>`.")

    job = await get_job(job_name)
    if not job:
        return await ctx.send("That job no longer exists.")

    cooldown = int(await get_setting("work_cooldown", "1800"))
    ready, remaining = await cooldown_ready(char_id, "work", cooldown)
    if not ready:
        return await ctx.send(f"**{name}** is on cooldown for {fmt_seconds(remaining)}.")

    _, min_pay, max_pay = job
    payout = random.randint(min_pay, max_pay)

    await add_wallet(char_id, payout)
    await set_cooldown(char_id, "work")

    await ctx.send(f"💼 **{name}** worked as a **{job_name}** and earned **${payout}**.")


@bot.command()
async def addjob(ctx, job_name: str, min_pay: int, max_pay: int):
    if not can_manage(ctx):
        return await ctx.send("Admins only.")

    if min_pay < 0 or max_pay < 0 or min_pay > max_pay:
        return await ctx.send("Use a valid pay range.")

    job_name = job_name.lower()

    async with aiosqlite.connect(DB) as db:
        await db.execute("""
            INSERT INTO jobs (job_name, min_pay, max_pay)
            VALUES (?, ?, ?)
            ON CONFLICT(job_name) DO UPDATE
            SET min_pay = excluded.min_pay,
                max_pay = excluded.max_pay
        """, (job_name, min_pay, max_pay))
        await db.commit()

    await ctx.send(f"Added/updated job **{job_name}** with pay **${min_pay}-${max_pay}**.")


@bot.command()
async def setjobpay(ctx, job_name: str, min_pay: int, max_pay: int):
    if not can_manage(ctx):
        return await ctx.send("Admins only.")

    if min_pay < 0 or max_pay < 0 or min_pay > max_pay:
        return await ctx.send("Use a valid pay range.")

    job_name = job_name.lower()

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            UPDATE jobs
            SET min_pay = ?, max_pay = ?
            WHERE job_name = ?
        """, (min_pay, max_pay, job_name))
        await db.commit()

        if cur.rowcount == 0:
            return await ctx.send("That job doesn't exist.")

    await ctx.send(f"Updated **{job_name}** pay to **${min_pay}-${max_pay}**.")


@bot.command()
async def removejob(ctx, job_name: str):
    if not can_manage(ctx):
        return await ctx.send("Admins only.")

    job_name = job_name.lower()

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("DELETE FROM jobs WHERE job_name = ?", (job_name,))
        await db.commit()

        if cur.rowcount == 0:
            return await ctx.send("That job doesn't exist.")

    await ctx.send(f"Removed **{job_name}**.")


# --------------------------------------------------
# GAS
# --------------------------------------------------
@bot.command()
async def gas(ctx):
    gas_price = await get_setting("gas_price", "5")
    await ctx.send(f"⛽ Gas price is **${gas_price}** per gallon.")


@bot.command()
async def setgas(ctx, price: int):
    if not can_manage(ctx):
        return await ctx.send("Admins only.")

    if price < 0:
        return await ctx.send("Gas price cannot be negative.")

    await set_setting("gas_price", str(price))
    await ctx.send(f"⛽ Gas price set to **${price}** per gallon.")


@bot.command()
async def fuel(ctx):
    active = await require_active_character(ctx)
    if not active:
        return
    await ctx.send(f"⛽ **{active[2]}** has **{active[6]}** fuel.")


@bot.command()
async def buygas(ctx, amount: int):
    active = await require_active_character(ctx)
    if not active:
        return

    char_id, _, name, _, wallet, _, _, _ = active
    gas_price = int(await get_setting("gas_price", "5"))
    total = gas_price * amount

    if amount <= 0:
        return await ctx.send("Amount must be positive.")
    if wallet < total:
        return await ctx.send(f"**{name}** needs ${total} but only has ${wallet}.")

    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "UPDATE characters SET wallet = wallet - ?, fuel = fuel + ? WHERE id = ?",
            (total, amount, char_id),
        )
        await db.commit()

    await ctx.send(f"⛽ **{name}** bought **{amount}** fuel for **${total}**.")


# --------------------------------------------------
# GAMES
# --------------------------------------------------
@bot.command()
async def coinflip(ctx, amount: int, choice: str):
    active = await require_active_character(ctx)
    if not active:
        return

    char_id, _, name, _, wallet, _, _, _ = active
    choice = choice.lower()

    if amount <= 0:
        return await ctx.send("Amount must be positive.")
    if choice not in ["heads", "tails"]:
        return await ctx.send("Choose `heads` or `tails`.")
    if wallet < amount:
        return await ctx.send(f"**{name}** does not have enough cash.")

    result = random.choice(["heads", "tails"])

    if result == choice:
        await add_wallet(char_id, amount)
        await ctx.send(f"🪙 It landed on **{result}**. **{name}** won **${amount}**.")
    else:
        await add_wallet(char_id, -amount)
        await ctx.send(f"🪙 It landed on **{result}**. **{name}** lost **${amount}**.")


@bot.command()
async def slots(ctx, amount: int):
    active = await require_active_character(ctx)
    if not active:
        return

    char_id, _, name, _, wallet, _, _, _ = active

    if amount <= 0:
        return await ctx.send("Amount must be positive.")
    if wallet < amount:
        return await ctx.send(f"**{name}** does not have enough cash.")

    symbols = ["🍒", "🍋", "💎", "7️⃣", "⭐"]
    roll = [random.choice(symbols) for _ in range(3)]

    if roll[0] == roll[1] == roll[2]:
        profit = amount * 4
        await add_wallet(char_id, profit)
        await ctx.send(f"{' '.join(roll)}\n**{name}** won **${profit}**.")
    elif len(set(roll)) == 2:
        profit = amount * 2
        await add_wallet(char_id, profit)
        await ctx.send(f"{' '.join(roll)}\n**{name}** won **${profit}**.")
    else:
        await add_wallet(char_id, -amount)
        await ctx.send(f"{' '.join(roll)}\n**{name}** lost **${amount}**.")


bot.run(TOKEN)
