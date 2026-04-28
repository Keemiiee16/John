import os
import random
from datetime import datetime, timezone

import discord
from discord.ext import commands
from dotenv import load_dotenv
import aiosqlite

print("JOHN CLEAN CHARACTER ECONOMY VERSION LOADED")

load_dotenv()
TOKEN = os.getenv("DISCORD_TOKEN")

if not TOKEN:
    raise SystemExit("DISCORD_TOKEN not set. Add DISCORD_TOKEN in .env locally or Render environment variables.")

intents = discord.Intents.default()
intents.message_content = True
intents.members = True

bot = commands.Bot(command_prefix="!", intents=intents, help_command=None)
DB = "database.db"


# ==================================================
# DATABASE
# ==================================================
async def init_db():
    async with aiosqlite.connect(DB) as db:
        await db.execute("""
        CREATE TABLE IF NOT EXISTS characters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            trigger TEXT DEFAULT '',
            avatar_url TEXT DEFAULT '',
            wallet INTEGER DEFAULT 500,
            bank INTEGER DEFAULT 1000,
            fuel INTEGER DEFAULT 0,
            job_name TEXT DEFAULT '',
            UNIQUE(owner_user_id, name),
            UNIQUE(owner_user_id, trigger)
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
        CREATE TABLE IF NOT EXISTS cars (
            car_name TEXT PRIMARY KEY,
            price INTEGER NOT NULL,
            description TEXT DEFAULT ''
        )
        """)

        await db.execute("""
        CREATE TABLE IF NOT EXISTS owned_cars (
            character_id INTEGER NOT NULL,
            car_name TEXT NOT NULL,
            PRIMARY KEY (character_id, car_name)
        )
        """)

        await db.execute("""
        CREATE TABLE IF NOT EXISTS houses (
            house_name TEXT PRIMARY KEY,
            price INTEGER NOT NULL,
            description TEXT DEFAULT ''
        )
        """)

        await db.execute("""
        CREATE TABLE IF NOT EXISTS owned_houses (
            character_id INTEGER NOT NULL,
            house_name TEXT NOT NULL,
            PRIMARY KEY (character_id, house_name)
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
    default_settings = {
        "starter_wallet": "500",
        "starter_bank": "1000",
        "gas_price": "5",
        "daily_min": "150",
        "daily_max": "300",
        "daily_cooldown": "86400",
        "work_cooldown": "1800",
        "buy_message": "Thanks for shopping with us!",
        "gas_message": "Drive safe!",
        "work_message": "Good work!",
        "daily_message": "Come back tomorrow!",
        "job_message": "Good luck at the new job!",
        "fuel_usage": "1",
    }

    default_items = [
        ("water", 5, "A bottle of water"),
        ("chips", 8, "A bag of chips"),
        ("burger", 15, "A quick meal"),
        ("bandage", 20, "Useful for injuries"),
        ("phone", 250, "A basic cellphone"),
    ]

    default_jobs = [
        ("cashier", 40, 80),
        ("delivery", 50, 100),
        ("mechanic", 70, 140),
        ("bartender", 60, 120),
        ("florist", 35, 75),
    ]

    default_cars = [
        ("civic", 4500, "Reliable starter car"),
        ("tesla", 35000, "Electric luxury car"),
        ("range_rover", 65000, "Luxury SUV"),
    ]

    default_houses = [
        ("apartment", 1200, "Cozy starter apartment"),
        ("townhouse", 8500, "Two bedroom townhouse"),
        ("mansion", 75000, "Luxury estate with gated driveway"),
    ]

    async with aiosqlite.connect(DB) as db:
        for key, value in default_settings.items():
            await db.execute("""
                INSERT INTO settings (setting_key, setting_value)
                VALUES (?, ?)
                ON CONFLICT(setting_key) DO NOTHING
            """, (key, value))

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

        for car_name, price, description in default_cars:
            await db.execute("""
                INSERT INTO cars (car_name, price, description)
                VALUES (?, ?, ?)
                ON CONFLICT(car_name) DO NOTHING
            """, (car_name, price, description))

        for house_name, price, description in default_houses:
            await db.execute("""
                INSERT INTO houses (house_name, price, description)
                VALUES (?, ?, ?)
                ON CONFLICT(house_name) DO NOTHING
            """, (house_name, price, description))

        await db.commit()


# ==================================================
# HELPERS
# ==================================================
def is_admin(ctx):
    return ctx.author.guild_permissions.administrator


def clean_key(value: str) -> str:
    return value.strip().lower().rstrip(":")


def fmt_seconds(seconds: int) -> str:
    minutes, sec = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}h {minutes}m {sec}s"
    if minutes:
        return f"{minutes}m {sec}s"
    return f"{sec}s"


def apply_template(template: str, **values) -> str:
    """Safely replace placeholders in custom reply templates."""
    if not template:
        return ""
    for key, value in values.items():
        template = template.replace("{" + key + "}", str(value))
    return template


async def get_setting(key: str, default: str = "") -> str:
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
            SELECT id, owner_user_id, name, trigger, avatar_url, wallet, bank, fuel, job_name
            FROM characters
            WHERE owner_user_id = ? AND lower(name) = lower(?)
        """, (user_id, name.strip()))
        return await cur.fetchone()


async def get_character_by_trigger_for_owner(user_id: int, trigger: str):
    trigger = clean_key(trigger)
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT id, owner_user_id, name, trigger, avatar_url, wallet, bank, fuel, job_name
            FROM characters
            WHERE owner_user_id = ?
              AND (lower(trigger) = lower(?) OR lower(name) = lower(?))
        """, (user_id, trigger, trigger))
        return await cur.fetchone()


async def get_any_character_by_name(name: str):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT id, owner_user_id, name, trigger, avatar_url, wallet, bank, fuel, job_name
            FROM characters
            WHERE lower(name) = lower(?)
        """, (name.strip(),))
        return await cur.fetchone()


async def get_active_character(user_id: int):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT c.id, c.owner_user_id, c.name, c.trigger, c.avatar_url, c.wallet, c.bank, c.fuel, c.job_name
            FROM active_characters ac
            JOIN characters c ON c.id = ac.character_id
            WHERE ac.user_id = ?
        """, (user_id,))
        return await cur.fetchone()


async def require_active_character(ctx):
    character = await get_active_character(ctx.author.id)
    if not character:
        await ctx.send("You need an active character first. Use `!createchar <name> <trigger>`.")
        return None
    return character


async def set_active_character(user_id: int, character_id: int):
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


async def cooldown_ready(character_id: int, command_name: str, seconds: int):
    now = datetime.now(timezone.utc)
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT last_used FROM cooldowns
            WHERE character_id = ? AND command_name = ?
        """, (character_id, command_name))
        row = await cur.fetchone()

    if not row:
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


# ==================================================
# EVENTS / PROXY
# ==================================================
@bot.event
async def on_ready():
    await init_db()
    print(f"Logged in as {bot.user} (ID: {bot.user.id})")


async def get_or_create_proxy_webhook(channel: discord.TextChannel):
    hooks = await channel.webhooks()
    for hook in hooks:
        if hook.user == bot.user and hook.name == "John Proxy":
            return hook
    return await channel.create_webhook(name="John Proxy")


async def try_proxy_character_message(message: discord.Message):
    if ":" not in message.content:
        return False

    trigger, content = message.content.split(":", 1)
    trigger = clean_key(trigger)
    content = content.strip()

    if not trigger or not content:
        return False

    character = await get_character_by_trigger_for_owner(message.author.id, trigger)
    if not character:
        return False

    char_id, owner_id, name, char_trigger, avatar_url, wallet, bank, fuel, job_name = character

    if not isinstance(message.channel, discord.TextChannel):
        return False

    try:
        webhook = await get_or_create_proxy_webhook(message.channel)
        await webhook.send(
            content=content,
            username=name,
            avatar_url=avatar_url if avatar_url else discord.utils.MISSING,
            allowed_mentions=discord.AllowedMentions.none(),
        )
        try:
            await message.delete()
        except discord.Forbidden:
            pass
        return True
    except discord.Forbidden:
        await message.channel.send("John needs **Manage Webhooks** permission for character proxying.")
        return True


@bot.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return

    if message.content.startswith("!"):
        await bot.process_commands(message)
        return

    proxied = await try_proxy_character_message(message)
    if proxied:
        return

    await bot.process_commands(message)


# ==================================================
# HELP
# ==================================================
@bot.command()
async def help(ctx):
    await ctx.send(
        "**Characters**\n"
        "`!createchar <name> <trigger>` — example: `!createchar Emely E`\n"
        "`!createcharpfp <name> <trigger> <avatar_url>` or upload an image with `!setavatar <name>`\n"
        "`!chars` `!switchchar <name>` `!whoami` `!deletechar <name>`\n"
        "Speak as a character with `E: text` or `Emely: text`\n\n"
        "**Economy**\n"
        "`!balance` `!deposit <amount>` `!withdraw <amount>` `!give <character> <amount>` `!daily`\n\n"
        "**Store**\n"
        "`!shop` `!buy <item> [amount]` `!inventory`\n"
        "Admin: `!additem <name> <price> <description>` `!setprice <item> <price>` `!removeitem <item>`\n\n"
        "**Jobs**\n"
        "`!jobs` `!setjob <job>` `!switchjob <job>` `!work`\n"
        "Admin: `!addjob <name> <min> <max>` `!setjobpay <name> <min> <max>` `!removejob <name>`\n\n"
        "**Gas**\n"
        "`!gas` `!fuel` `!buygas <amount>`\n"
        "Admin: `!setgas <price>` `!setfuel <character> <amount>`\n\n"
        "**Games**\n"
        "`!coinflip <amount> <heads/tails>` `!slots <amount>`\n\n**Custom Replies Admin**\n`!setreply <buy/gas/work/daily/job> <message>`\n`!replies`"
    )


# ==================================================
# CHARACTER COMMANDS
# ==================================================
@bot.command()
async def createchar(ctx, name: str, trigger: str):
    trigger = clean_key(trigger)

    existing_name = await get_character_by_name_for_owner(ctx.author.id, name)
    if existing_name:
        return await ctx.send("You already have a character with that name.")

    existing_trigger = await get_character_by_trigger_for_owner(ctx.author.id, trigger)
    if existing_trigger:
        return await ctx.send("You already have a character using that trigger.")

    starter_wallet = int(await get_setting("starter_wallet", "500"))
    starter_bank = int(await get_setting("starter_bank", "1000"))

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            INSERT INTO characters (owner_user_id, name, trigger, avatar_url, wallet, bank, fuel, job_name)
            VALUES (?, ?, ?, '', ?, ?, 0, '')
        """, (ctx.author.id, name.strip(), trigger, starter_wallet, starter_bank))
        char_id = cur.lastrowid
        await db.commit()

    await set_active_character(ctx.author.id, char_id)
    await ctx.send(f"Created **{name}** with trigger **{trigger}:** and made them active.")


@bot.command()
async def createcharpfp(ctx, name: str, trigger: str, avatar_url: str):
    trigger = clean_key(trigger)

    existing_name = await get_character_by_name_for_owner(ctx.author.id, name)
    if existing_name:
        return await ctx.send("You already have a character with that name.")

    existing_trigger = await get_character_by_trigger_for_owner(ctx.author.id, trigger)
    if existing_trigger:
        return await ctx.send("You already have a character using that trigger.")

    starter_wallet = int(await get_setting("starter_wallet", "500"))
    starter_bank = int(await get_setting("starter_bank", "1000"))

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            INSERT INTO characters (owner_user_id, name, trigger, avatar_url, wallet, bank, fuel, job_name)
            VALUES (?, ?, ?, ?, ?, ?, 0, '')
        """, (ctx.author.id, name.strip(), trigger, avatar_url, starter_wallet, starter_bank))
        char_id = cur.lastrowid
        await db.commit()

    await set_active_character(ctx.author.id, char_id)
    await ctx.send(f"Created **{name}** with trigger **{trigger}:** and avatar.")


@bot.command()
async def chars(ctx):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT id, name, trigger, wallet, bank, fuel, job_name
            FROM characters
            WHERE owner_user_id = ?
            ORDER BY name ASC
        """, (ctx.author.id,))
        rows = await cur.fetchall()

    if not rows:
        return await ctx.send("You do not have any characters yet. Use `!createchar <name> <trigger>`.")

    active = await get_active_character(ctx.author.id)
    active_id = active[0] if active else None

    msg = "**Your characters:**\n"
    for char_id, name, trigger, wallet, bank, fuel, job_name in rows:
        marker = " ⭐" if char_id == active_id else ""
        msg += f"- **{name}**{marker} | Trigger `{trigger}:` | Wallet ${wallet} | Bank ${bank} | Fuel {fuel} | Job {job_name or 'none'}\n"
    await ctx.send(msg)


@bot.command()
async def switchchar(ctx, name: str):
    character = await get_character_by_name_for_owner(ctx.author.id, name)
    if not character:
        return await ctx.send("You do not own a character with that name.")

    await set_active_character(ctx.author.id, character[0])
    await ctx.send(f"Switched active character to **{character[2]}**.")


@bot.command()
async def whoami(ctx):
    character = await get_active_character(ctx.author.id)
    if not character:
        return await ctx.send("No active character. Use `!createchar <name> <trigger>`.")
    await ctx.send(f"You are currently **{character[2]}** with trigger `{character[3]}:`.")


@bot.command()
async def deletechar(ctx, name: str):
    character = await get_character_by_name_for_owner(ctx.author.id, name)
    if not character:
        return await ctx.send("You do not own a character with that name.")

    char_id = character[0]
    async with aiosqlite.connect(DB) as db:
        await db.execute("DELETE FROM inventory WHERE character_id = ?", (char_id,))
        await db.execute("DELETE FROM cooldowns WHERE character_id = ?", (char_id,))
        await db.execute("DELETE FROM active_characters WHERE character_id = ?", (char_id,))
        await db.execute("DELETE FROM characters WHERE id = ?", (char_id,))
        await db.commit()

    await ctx.send(f"Deleted **{character[2]}**.")



@bot.command()
async def setavatar(ctx, name: str):
    character = await get_character_by_name_for_owner(ctx.author.id, name)
    if not character:
        return await ctx.send("You do not own a character with that name.")

    if not ctx.message.attachments:
        return await ctx.send("Upload an image with the command. Example: attach a photo and type `!setavatar Emely`.")

    attachment = ctx.message.attachments[0]

    if not attachment.content_type or not attachment.content_type.startswith("image/"):
        return await ctx.send("That attachment does not look like an image.")

    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "UPDATE characters SET avatar_url = ? WHERE id = ?",
            (attachment.url, character[0]),
        )
        await db.commit()

    await ctx.send(f"Updated **{character[2]}**'s profile picture.")


# ==================================================
# ECONOMY COMMANDS
# ==================================================
@bot.command()
async def balance(ctx):
    character = await require_active_character(ctx)
    if not character:
        return
    char_id, owner_id, name, trigger, avatar, wallet, bank, fuel, job = character
    await ctx.send(f"**{name}** — Wallet ${wallet} | Bank ${bank} | Fuel {fuel} | Job {job or 'none'}")


@bot.command()
async def deposit(ctx, amount: int):
    character = await require_active_character(ctx)
    if not character:
        return
    char_id, owner_id, name, trigger, avatar, wallet, bank, fuel, job = character

    if amount <= 0:
        return await ctx.send("Amount must be positive.")
    if wallet < amount:
        return await ctx.send(f"**{name}** does not have enough wallet cash.")

    async with aiosqlite.connect(DB) as db:
        await db.execute("UPDATE characters SET wallet = wallet - ?, bank = bank + ? WHERE id = ?", (amount, amount, char_id))
        await db.commit()

    await ctx.send(f"Deposited **${amount}** for **{name}**.")


@bot.command()
async def withdraw(ctx, amount: int):
    character = await require_active_character(ctx)
    if not character:
        return
    char_id, owner_id, name, trigger, avatar, wallet, bank, fuel, job = character

    if amount <= 0:
        return await ctx.send("Amount must be positive.")
    if bank < amount:
        return await ctx.send(f"**{name}** does not have enough in the bank.")

    async with aiosqlite.connect(DB) as db:
        await db.execute("UPDATE characters SET wallet = wallet + ?, bank = bank - ? WHERE id = ?", (amount, amount, char_id))
        await db.commit()

    await ctx.send(f"Withdrew **${amount}** for **{name}**.")


@bot.command()
async def give(ctx, target_character: str, amount: int):
    character = await require_active_character(ctx)
    if not character:
        return
    char_id, owner_id, name, trigger, avatar, wallet, bank, fuel, job = character

    if amount <= 0:
        return await ctx.send("Amount must be positive.")
    if wallet < amount:
        return await ctx.send(f"**{name}** does not have enough wallet cash.")

    target = await get_any_character_by_name(target_character)
    if not target:
        return await ctx.send("That character does not exist.")

    if target[0] == char_id:
        return await ctx.send("You cannot give money to the same character.")

    async with aiosqlite.connect(DB) as db:
        await db.execute("UPDATE characters SET wallet = wallet - ? WHERE id = ?", (amount, char_id))
        await db.execute("UPDATE characters SET wallet = wallet + ? WHERE id = ?", (amount, target[0]))
        await db.commit()

    await ctx.send(f"**{name}** gave **${amount}** to **{target[2]}**.")


@bot.command()
async def daily(ctx):
    character = await require_active_character(ctx)
    if not character:
        return
    char_id, owner_id, name, trigger, avatar, wallet, bank, fuel, job = character

    cooldown = int(await get_setting("daily_cooldown", "86400"))
    ready, remaining = await cooldown_ready(char_id, "daily", cooldown)
    if not ready:
        return await ctx.send(f"**{name}** already claimed daily. Try again in {fmt_seconds(remaining)}.")

    daily_min = int(await get_setting("daily_min", "150"))
    daily_max = int(await get_setting("daily_max", "300"))
    payout = random.randint(daily_min, daily_max)

    await add_wallet(char_id, payout)
    await set_cooldown(char_id, "daily")
    extra = await get_setting("daily_message", "Come back tomorrow!")
    extra = apply_template(extra, character=name, payout=payout)
    await ctx.send(f"🎁 **{name}** claimed daily and got **${payout}**.\n{extra}")


# ==================================================
# STORE COMMANDS
# ==================================================
@bot.command()
async def shop(ctx):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT item_name, price, description FROM shop_items ORDER BY item_name ASC")
        rows = await cur.fetchall()

    if not rows:
        return await ctx.send("The shop is empty.")

    embed = discord.Embed(title="🛒 John's Shop", color=discord.Color.blue())
    for item_name, price, description in rows:
        embed.add_field(name=f"{item_name} — ${price}", value=description or "No description", inline=False)
    await ctx.send(embed=embed)


@bot.command()
async def additem(ctx, item_name: str, price: int, *, description: str = ""):
    if not is_admin(ctx):
        return await ctx.send("Admins only.")
    if price < 0:
        return await ctx.send("Price cannot be negative.")

    item_name = clean_key(item_name)
    async with aiosqlite.connect(DB) as db:
        await db.execute("""
            INSERT INTO shop_items (item_name, price, description)
            VALUES (?, ?, ?)
            ON CONFLICT(item_name) DO UPDATE
            SET price = excluded.price, description = excluded.description
        """, (item_name, price, description))
        await db.commit()

    await ctx.send(f"Added/updated **{item_name}** for **${price}**.")


@bot.command()
async def setprice(ctx, item_name: str, price: int):
    if not is_admin(ctx):
        return await ctx.send("Admins only.")
    if price < 0:
        return await ctx.send("Price cannot be negative.")

    item_name = clean_key(item_name)
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("UPDATE shop_items SET price = ? WHERE item_name = ?", (price, item_name))
        await db.commit()
        if cur.rowcount == 0:
            return await ctx.send("That item does not exist.")

    await ctx.send(f"Updated **{item_name}** to **${price}**.")


@bot.command()
async def removeitem(ctx, item_name: str):
    if not is_admin(ctx):
        return await ctx.send("Admins only.")

    item_name = clean_key(item_name)
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("DELETE FROM shop_items WHERE item_name = ?", (item_name,))
        await db.commit()
        if cur.rowcount == 0:
            return await ctx.send("That item does not exist.")

    await ctx.send(f"Removed **{item_name}** from the shop.")


@bot.command()
async def buy(ctx, item_name: str, amount: int = 1):
    character = await require_active_character(ctx)
    if not character:
        return
    char_id, owner_id, name, trigger, avatar, wallet, bank, fuel, job = character

    if amount <= 0:
        return await ctx.send("Amount must be positive.")

    item_name = clean_key(item_name)
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT price FROM shop_items WHERE item_name = ?", (item_name,))
        item = await cur.fetchone()
        if not item:
            return await ctx.send("That item is not in the shop.")

        price = item[0]
        total = price * amount
        if wallet < total:
            return await ctx.send(f"**{name}** needs ${total} but only has ${wallet}.")

        await db.execute("UPDATE characters SET wallet = wallet - ? WHERE id = ?", (total, char_id))
        await db.execute("""
            INSERT INTO inventory (character_id, item_name, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(character_id, item_name)
            DO UPDATE SET quantity = quantity + excluded.quantity
        """, (char_id, item_name, amount))
        await db.commit()

    extra = await get_setting("buy_message", "Thanks for shopping with us!")
    extra = apply_template(extra, character=name, item=item_name, amount=amount, total=total, price=price)
    await ctx.send(f"✅ **{name}** bought **{amount}x {item_name}** for **${total}**.\n{extra}")


@bot.command()
async def inventory(ctx):
    character = await require_active_character(ctx)
    if not character:
        return
    char_id = character[0]
    name = character[2]

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT item_name, quantity FROM inventory WHERE character_id = ? AND quantity > 0 ORDER BY item_name ASC", (char_id,))
        rows = await cur.fetchall()

    if not rows:
        return await ctx.send(f"**{name}** has an empty inventory.")

    msg = f"**{name}'s inventory:**\n"
    for item_name, quantity in rows:
        msg += f"- {item_name}: {quantity}\n"
    await ctx.send(msg)


# ==================================================
# JOB COMMANDS
# ==================================================
@bot.command()
async def jobs(ctx):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT job_name, min_pay, max_pay FROM jobs ORDER BY job_name ASC")
        rows = await cur.fetchall()

    if not rows:
        return await ctx.send("No jobs are set up yet.")

    msg = "**Available jobs:**\n"
    for job_name, min_pay, max_pay in rows:
        msg += f"- {job_name}: ${min_pay}-${max_pay}\n"
    await ctx.send(msg)


@bot.command()
async def addjob(ctx, job_name: str, min_pay: int, max_pay: int):
    if not is_admin(ctx):
        return await ctx.send("Admins only.")
    if min_pay < 0 or max_pay < 0 or min_pay > max_pay:
        return await ctx.send("Use a valid pay range. Example: `!addjob nurse 80 160`")

    job_name = clean_key(job_name)
    async with aiosqlite.connect(DB) as db:
        await db.execute("""
            INSERT INTO jobs (job_name, min_pay, max_pay)
            VALUES (?, ?, ?)
            ON CONFLICT(job_name) DO UPDATE
            SET min_pay = excluded.min_pay, max_pay = excluded.max_pay
        """, (job_name, min_pay, max_pay))
        await db.commit()

    await ctx.send(f"Added/updated job **{job_name}** with pay **${min_pay}-${max_pay}**.")


@bot.command()
async def setjobpay(ctx, job_name: str, min_pay: int, max_pay: int):
    if not is_admin(ctx):
        return await ctx.send("Admins only.")
    if min_pay < 0 or max_pay < 0 or min_pay > max_pay:
        return await ctx.send("Use a valid pay range.")

    job_name = clean_key(job_name)
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("UPDATE jobs SET min_pay = ?, max_pay = ? WHERE job_name = ?", (min_pay, max_pay, job_name))
        await db.commit()
        if cur.rowcount == 0:
            return await ctx.send("That job does not exist.")

    await ctx.send(f"Updated **{job_name}** pay to **${min_pay}-${max_pay}**.")


@bot.command()
async def removejob(ctx, job_name: str):
    if not is_admin(ctx):
        return await ctx.send("Admins only.")

    job_name = clean_key(job_name)
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("DELETE FROM jobs WHERE job_name = ?", (job_name,))
        await db.commit()
        if cur.rowcount == 0:
            return await ctx.send("That job does not exist.")

    await ctx.send(f"Removed job **{job_name}**.")


@bot.command()
async def setjob(ctx, job_name: str):
    character = await require_active_character(ctx)
    if not character:
        return

    char_id = character[0]
    name = character[2]
    job_name = clean_key(job_name)

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT job_name FROM jobs WHERE job_name = ?", (job_name,))
        job = await cur.fetchone()
        if not job:
            return await ctx.send("That job does not exist. Use `!jobs`.")

        await db.execute("UPDATE characters SET job_name = ? WHERE id = ?", (job_name, char_id))
        await db.commit()

    extra = await get_setting("job_message", "Good luck at the new job!")
    extra = apply_template(extra, character=name, job=job_name)
    await ctx.send(f"**{name}** is now a **{job_name}**.\n{extra}")


@bot.command()
async def work(ctx):
    character = await require_active_character(ctx)
    if not character:
        return

    char_id, owner_id, name, trigger, avatar, wallet, bank, fuel, job_name = character
    if not job_name:
        return await ctx.send(f"**{name}** does not have a job yet. Use `!setjob <job>`.")

    cooldown = int(await get_setting("work_cooldown", "1800"))
    ready, remaining = await cooldown_ready(char_id, "work", cooldown)
    if not ready:
        return await ctx.send(f"**{name}** is on work cooldown for {fmt_seconds(remaining)}.")

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT min_pay, max_pay FROM jobs WHERE job_name = ?", (job_name,))
        row = await cur.fetchone()
        if not row:
            return await ctx.send("That job no longer exists. Pick a new job.")

        min_pay, max_pay = row
        payout = random.randint(min_pay, max_pay)
        await db.execute("UPDATE characters SET wallet = wallet + ? WHERE id = ?", (payout, char_id))
        await db.commit()

    await set_cooldown(char_id, "work")
    extra = await get_setting("work_message", "Good work!")
    extra = apply_template(extra, character=name, job=job_name, payout=payout)
    await ctx.send(f"💼 **{name}** worked as a **{job_name}** and earned **${payout}**.\n{extra}")



@bot.command()
async def switchjob(ctx, job_name: str):
    """Alias for setjob, so users can switch jobs clearly."""
    await setjob(ctx, job_name)


@bot.command()
async def setreply(ctx, reply_type: str, *, message: str):
    if not is_admin(ctx):
        return await ctx.send("Admins only.")

    reply_type = clean_key(reply_type)
    valid = {
        "buy": "buy_message",
        "gas": "gas_message",
        "work": "work_message",
        "daily": "daily_message",
        "job": "job_message",
    }

    if reply_type not in valid:
        return await ctx.send("Choose one: `buy`, `gas`, `work`, `daily`, or `job`.")

    await set_setting(valid[reply_type], message)
    await ctx.send(f"Updated **{reply_type}** reply message.")

@bot.command()
async def replies(ctx):
    buy = await get_setting("buy_message", "")
    gas = await get_setting("gas_message", "")
    work = await get_setting("work_message", "")
    daily = await get_setting("daily_message", "")
    job = await get_setting("job_message", "")

    await ctx.send(
        "**Current custom replies:**\n"
        f"**buy:** {buy}\n"
        f"**gas:** {gas}\n"
        f"**work:** {work}\n"
        f"**daily:** {daily}\n"
        f"**job:** {job}\n\n"
        "Placeholders you can use:\n"
        "`{character}` `{item}` `{amount}` `{total}` `{price}` `{job}` `{payout}`"
    )


# ==================================================
# GAS COMMANDS
# ==================================================
@bot.command()
async def gas(ctx):
    price = await get_setting("gas_price", "5")
    await ctx.send(f"⛽ Gas price is **${price}** per fuel unit.")


@bot.command()
async def setgas(ctx, price: int):
    if not is_admin(ctx):
        return await ctx.send("Admins only.")
    if price < 0:
        return await ctx.send("Gas price cannot be negative.")

    await set_setting("gas_price", str(price))
    await ctx.send(f"⛽ Gas price set to **${price}** per fuel unit.")


@bot.command()
async def fuel(ctx):
    character = await require_active_character(ctx)
    if not character:
        return
    await ctx.send(f"⛽ **{character[2]}** has **{character[7]}** fuel.")


@bot.command()
async def buygas(ctx, amount: int):
    character = await require_active_character(ctx)
    if not character:
        return

    char_id, owner_id, name, trigger, avatar, wallet, bank, fuel, job = character
    price = int(await get_setting("gas_price", "5"))
    total = price * amount

    if amount <= 0:
        return await ctx.send("Amount must be positive.")
    if wallet < total:
        return await ctx.send(f"**{name}** needs ${total} but only has ${wallet}.")

    async with aiosqlite.connect(DB) as db:
        await db.execute("UPDATE characters SET wallet = wallet - ?, fuel = fuel + ? WHERE id = ?", (total, amount, char_id))
        await db.commit()

    extra = await get_setting("gas_message", "Drive safe!")
    extra = apply_template(extra, character=name, amount=amount, total=total, price=price)
    await ctx.send(f"⛽ **{name}** bought **{amount}** fuel for **${total}**.\n{extra}")


@bot.command()
async def setfuel(ctx, character_name: str, amount: int):
    if not is_admin(ctx):
        return await ctx.send("Admins only.")
    if amount < 0:
        return await ctx.send("Fuel cannot be negative.")

    character = await get_any_character_by_name(character_name)
    if not character:
        return await ctx.send("That character does not exist.")

    async with aiosqlite.connect(DB) as db:
        await db.execute("UPDATE characters SET fuel = ? WHERE id = ?", (amount, character[0]))
        await db.commit()

    await ctx.send(f"Set **{character[2]}** fuel to **{amount}**.")



# ==================================================
# CAR COMMANDS
# ==================================================
@bot.command()
async def cars(ctx):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT car_name, price, description FROM cars ORDER BY price ASC")
        rows = await cur.fetchall()

    if not rows:
        return await ctx.send("No cars are available.")

    fuel_usage = await get_setting("fuel_usage", "1")
    embed = discord.Embed(
        title="🚗 Car Lot",
        description=f"Universal fuel usage: **{fuel_usage} fuel per mile**",
        color=discord.Color.dark_blue(),
    )
    for car_name, price, description in rows:
        embed.add_field(name=f"{car_name} — ${price}", value=description or "No description", inline=False)
    await ctx.send(embed=embed)


@bot.command()
async def addcar(ctx, car_name: str, price: int, *, description: str = ""):
    if not is_admin(ctx):
        return await ctx.send("Admins only.")
    if price < 0:
        return await ctx.send("Price cannot be negative.")

    car_name = clean_key(car_name)
    async with aiosqlite.connect(DB) as db:
        await db.execute("""
            INSERT INTO cars (car_name, price, description)
            VALUES (?, ?, ?)
            ON CONFLICT(car_name) DO UPDATE
            SET price = excluded.price, description = excluded.description
        """, (car_name, price, description))
        await db.commit()

    await ctx.send(f"Added/updated car **{car_name}** for **${price}**.")


@bot.command()
async def removecar(ctx, car_name: str):
    if not is_admin(ctx):
        return await ctx.send("Admins only.")

    car_name = clean_key(car_name)
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("DELETE FROM cars WHERE car_name = ?", (car_name,))
        await db.execute("DELETE FROM owned_cars WHERE car_name = ?", (car_name,))
        await db.commit()
        if cur.rowcount == 0:
            return await ctx.send("That car does not exist.")

    await ctx.send(f"Removed car **{car_name}**.")


@bot.command()
async def setfuelusage(ctx, amount: int):
    if not is_admin(ctx):
        return await ctx.send("Admins only.")
    if amount < 0:
        return await ctx.send("Fuel usage cannot be negative.")

    await set_setting("fuel_usage", str(amount))
    await ctx.send(f"Universal fuel usage set to **{amount} fuel per mile**.")


@bot.command()
async def buycar(ctx, car_name: str):
    character = await require_active_character(ctx)
    if not character:
        return

    char_id, owner_id, name, trigger, avatar, wallet, bank, fuel, job = character
    car_name = clean_key(car_name)

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT price FROM cars WHERE car_name = ?", (car_name,))
        car = await cur.fetchone()
        if not car:
            return await ctx.send("That car is not available.")

        price = car[0]
        if wallet < price:
            return await ctx.send(f"**{name}** needs ${price} but only has ${wallet}.")

        await db.execute("UPDATE characters SET wallet = wallet - ? WHERE id = ?", (price, char_id))
        await db.execute("""
            INSERT INTO owned_cars (character_id, car_name)
            VALUES (?, ?)
            ON CONFLICT(character_id, car_name) DO NOTHING
        """, (char_id, car_name))
        await db.commit()

    await ctx.send(f"🚗 **{name}** bought **{car_name}** for **${price}**.")


@bot.command()
async def garage(ctx):
    character = await require_active_character(ctx)
    if not character:
        return

    char_id = character[0]
    name = character[2]

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT oc.car_name, c.description
            FROM owned_cars oc
            LEFT JOIN cars c ON c.car_name = oc.car_name
            WHERE oc.character_id = ?
            ORDER BY oc.car_name ASC
        """, (char_id,))
        rows = await cur.fetchall()

    if not rows:
        return await ctx.send(f"**{name}** does not own any cars.")

    msg = f"🚗 **{name}'s garage:**\n"
    for car_name, description in rows:
        msg += f"- {car_name}: {description or 'No description'}\n"
    await ctx.send(msg)


@bot.command()
async def drive(ctx, car_name: str, miles: int):
    character = await require_active_character(ctx)
    if not character:
        return

    char_id, owner_id, name, trigger, avatar, wallet, bank, fuel, job = character
    car_name = clean_key(car_name)

    if miles <= 0:
        return await ctx.send("Miles must be positive.")

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute(
            "SELECT car_name FROM owned_cars WHERE character_id = ? AND car_name = ?",
            (char_id, car_name),
        )
        owned = await cur.fetchone()

    if not owned:
        return await ctx.send(f"**{name}** does not own **{car_name}**.")

    fuel_usage = int(await get_setting("fuel_usage", "1"))
    needed_fuel = fuel_usage * miles

    if fuel < needed_fuel:
        return await ctx.send(f"**{name}** needs **{needed_fuel} fuel** but only has **{fuel}**.")

    async with aiosqlite.connect(DB) as db:
        await db.execute("UPDATE characters SET fuel = fuel - ? WHERE id = ?", (needed_fuel, char_id))
        await db.commit()

    await ctx.send(f"🚗 **{name}** drove **{car_name}** for **{miles} miles** and used **{needed_fuel} fuel**.")


# ==================================================
# HOUSING COMMANDS
# ==================================================
@bot.command()
async def houses(ctx):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT house_name, price, description FROM houses ORDER BY price ASC")
        rows = await cur.fetchall()

    if not rows:
        return await ctx.send("No houses are available.")

    embed = discord.Embed(title="🏠 Housing Market", color=discord.Color.green())
    for house_name, price, description in rows:
        embed.add_field(name=f"{house_name} — ${price}", value=description or "No description", inline=False)
    await ctx.send(embed=embed)


@bot.command()
async def addhouse(ctx, house_name: str, price: int, *, description: str = ""):
    if not is_admin(ctx):
        return await ctx.send("Admins only.")
    if price < 0:
        return await ctx.send("Price cannot be negative.")

    house_name = clean_key(house_name)
    async with aiosqlite.connect(DB) as db:
        await db.execute("""
            INSERT INTO houses (house_name, price, description)
            VALUES (?, ?, ?)
            ON CONFLICT(house_name) DO UPDATE
            SET price = excluded.price, description = excluded.description
        """, (house_name, price, description))
        await db.commit()

    await ctx.send(f"Added/updated house **{house_name}** for **${price}**.")


@bot.command()
async def removehouse(ctx, house_name: str):
    if not is_admin(ctx):
        return await ctx.send("Admins only.")

    house_name = clean_key(house_name)
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("DELETE FROM houses WHERE house_name = ?", (house_name,))
        await db.execute("DELETE FROM owned_houses WHERE house_name = ?", (house_name,))
        await db.commit()
        if cur.rowcount == 0:
            return await ctx.send("That house does not exist.")

    await ctx.send(f"Removed house **{house_name}**.")


@bot.command()
async def buyhouse(ctx, house_name: str):
    character = await require_active_character(ctx)
    if not character:
        return

    char_id, owner_id, name, trigger, avatar, wallet, bank, fuel, job = character
    house_name = clean_key(house_name)

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("SELECT price FROM houses WHERE house_name = ?", (house_name,))
        house = await cur.fetchone()
        if not house:
            return await ctx.send("That house is not available.")

        price = house[0]
        if wallet < price:
            return await ctx.send(f"**{name}** needs ${price} but only has ${wallet}.")

        await db.execute("UPDATE characters SET wallet = wallet - ? WHERE id = ?", (price, char_id))
        await db.execute("""
            INSERT INTO owned_houses (character_id, house_name)
            VALUES (?, ?)
            ON CONFLICT(character_id, house_name) DO NOTHING
        """, (char_id, house_name))
        await db.commit()

    await ctx.send(f"🏠 **{name}** bought **{house_name}** for **${price}**.")


@bot.command()
async def myhouses(ctx):
    character = await require_active_character(ctx)
    if not character:
        return

    char_id = character[0]
    name = character[2]

    async with aiosqlite.connect(DB) as db:
        cur = await db.execute("""
            SELECT oh.house_name, h.description
            FROM owned_houses oh
            LEFT JOIN houses h ON h.house_name = oh.house_name
            WHERE oh.character_id = ?
            ORDER BY oh.house_name ASC
        """, (char_id,))
        rows = await cur.fetchall()

    if not rows:
        return await ctx.send(f"**{name}** does not own any houses.")

    msg = f"🏠 **{name}'s houses:**\n"
    for house_name, description in rows:
        msg += f"- {house_name}: {description or 'No description'}\n"
    await ctx.send(msg)


# ==================================================
# GAMES
# ==================================================
@bot.command()
async def coinflip(ctx, amount: int, choice: str):
    character = await require_active_character(ctx)
    if not character:
        return

    char_id, owner_id, name, trigger, avatar, wallet, bank, fuel, job = character
    choice = clean_key(choice)

    if amount <= 0:
        return await ctx.send("Amount must be positive.")
    if choice not in ["heads", "tails"]:
        return await ctx.send("Choose `heads` or `tails`.")
    if wallet < amount:
        return await ctx.send(f"**{name}** does not have enough wallet cash.")

    result = random.choice(["heads", "tails"])
    if result == choice:
        await add_wallet(char_id, amount)
        await ctx.send(f"🪙 It landed on **{result}**. **{name}** won **${amount}**.")
    else:
        await add_wallet(char_id, -amount)
        await ctx.send(f"🪙 It landed on **{result}**. **{name}** lost **${amount}**.")


@bot.command()
async def slots(ctx, amount: int):
    character = await require_active_character(ctx)
    if not character:
        return

    char_id, owner_id, name, trigger, avatar, wallet, bank, fuel, job = character

    if amount <= 0:
        return await ctx.send("Amount must be positive.")
    if wallet < amount:
        return await ctx.send(f"**{name}** does not have enough wallet cash.")

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
