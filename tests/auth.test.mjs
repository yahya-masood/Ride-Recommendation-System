// tests/auth.test.mjs - AUTOMATED NODE TESTS for js/auth.js. Run: node tests/auth.test.mjs
import { group, check, finish, resetStore, rawGet, rawSet, fake, NOW, MIN } from "./testKit.mjs";
const auth = await import("../js/auth.js");
const storage = await import("../js/storage.js");

const driver = (over = {}) => ({ name: "Ali Khan", role: "Driver", password: "secret1", fuelEfficiency: 12, vehicleSeats: 4, ...over });
const passenger = (over = {}) => ({ name: "Sara Noor", role: "Passenger", password: "secret1", ...over });

group("1 hashing");
const h1 = await auth.hashPassword("abc123"), h2 = await auth.hashPassword("abc123");
check("same password gives different stored text (salt)", h1 !== h2);
check("stored text has salt:hash form", /^[0-9a-f]{16}:[0-9a-f]{64}$/.test(h1));
check("password is not in the stored text", !h1.includes("abc123"));
check("verify accepts the right password", await auth.verifyPassword("abc123", h1));
check("verify rejects a wrong password", !(await auth.verifyPassword("abc124", h1)));
check("verify rejects broken stored text", !(await auth.verifyPassword("abc123", "nonsense")) && !(await auth.verifyPassword("abc123", null)));

group("2 registration");
resetStore();
const r1 = await auth.register(driver());
check("driver registers", r1.ok && r1.user.role === "Driver" && r1.user.fuelEfficiency === 12 && !("passwordHash" in r1.user));
check("stored password is hashed", !rawGet("rr_users").includes("secret1"));
check("passenger registers", (await auth.register(passenger())).ok);
check("duplicate name rejected (any case)", !(await auth.register(passenger({ name: " sara noor " }))).ok);
check("administrator cannot self register", !(await auth.register({ name: "Boss", role: "Administrator", password: "secret1" })).ok);
check("missing name rejected", !(await auth.register(passenger({ name: "  " }))).ok);
check("short password rejected", !(await auth.register(passenger({ name: "P2", password: "12345" }))).ok);
check("driver needs fuel efficiency", !(await auth.register(driver({ name: "D2", fuelEfficiency: undefined }))).ok);
check("fuel efficiency 0 rejected", !(await auth.register(driver({ name: "D3", fuelEfficiency: 0 }))).ok);
check("fuel efficiency negative rejected", !(await auth.register(driver({ name: "D4", fuelEfficiency: -3 }))).ok);
check("fuel efficiency as text rejected", !(await auth.register(driver({ name: "D5", fuelEfficiency: "12" }))).ok);
check("vehicle seats 0 rejected", !(await auth.register(driver({ name: "D6", vehicleSeats: 0 }))).ok);
check("vehicle seats optional", (await auth.register(driver({ name: "D7", vehicleSeats: undefined }))).ok);
check("null input rejected without throwing", !(await auth.register(null)).ok);
fake.failWrites = true;
check("save failure reported", !(await auth.register(passenger({ name: "P9" }))).ok);
fake.failWrites = false;

group("3 seed administrator");
resetStore();
check("seed created once", (await auth.ensureSeedAdmin()) === true && (await auth.ensureSeedAdmin()) === false);
check("only one admin exists", storage.getList("users").filter(u => u.role === "Administrator").length === 1);
check("seed admin can log in", (await auth.login("admin", "Admin@123", NOW)).ok);

group("4 login and session");
resetStore();
await auth.register(driver()); await auth.register(passenger());
const l1 = await auth.login("ali khan", "secret1", NOW);
check("login works (name not case sensitive)", l1.ok && l1.user.role === "Driver");
check("session saved", storage.getSession().userId === l1.user.userId);
check("wrong password refused", (await auth.login("Ali Khan", "wrong", NOW)).reason === "invalid");
check("unknown name refused (same message)", (await auth.login("Nobody", "secret1", NOW)).error === (await auth.login("Ali Khan", "wrong", NOW)).error);
check("non-text password refused without throwing", (await auth.login("Ali Khan", null, NOW)).ok === false);
await auth.login("Ali Khan", "secret1", NOW);
check("getCurrentUser returns the user", auth.getCurrentUser(NOW + MIN).name === "Ali Khan");
check("14 minutes idle still logged in", auth.getCurrentUser(NOW + 14 * MIN) !== null);
check("15 minutes idle logs out", auth.getCurrentUser(NOW + 15 * MIN) === null && storage.getSession() === null);
await auth.login("Ali Khan", "secret1", NOW);
auth.touchSession(NOW + 10 * MIN);
check("activity extends the session", auth.getCurrentUser(NOW + 20 * MIN) !== null);
check("logout clears the session", (auth.logout(), storage.getSession() === null));
check("no session gives null", auth.getCurrentUser(NOW) === null);

group("5 roles and deactivated accounts");
resetStore();
await auth.register(driver()); await auth.register(passenger());
await auth.login("Ali Khan", "secret1", NOW);
check("driver passes Driver check", auth.requireRole("Driver", NOW) !== null);
check("driver fails Administrator check", auth.requireRole(["Administrator"], NOW) === null);
check("driver passes list check", auth.requireRole(["Driver", "Passenger"], NOW) !== null);
const users = storage.getList("users"); users[0].active = false; storage.saveList("users", users);
check("deactivated user is logged out", auth.getCurrentUser(NOW) === null);
check("deactivated user cannot log in", (await auth.login("Ali Khan", "secret1", NOW)).reason === "deactivated");
check("deactivated with wrong password still says invalid", (await auth.login("Ali Khan", "x", NOW)).reason === "invalid");
rawSet("rr_session", "garbage");
check("broken session data gives null", auth.getCurrentUser(NOW) === null);
check("getUserName and getUserById", auth.getUserName(users[1].userId) === "Sara Noor" && auth.getUserById("none") === null && auth.getUserName("none") === "");

finish("js/auth.js");
