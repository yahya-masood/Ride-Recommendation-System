// tests/admin.test.mjs - AUTOMATED NODE TESTS for js/admin.js. Run: node tests/admin.test.mjs
import { group, check, finish, resetStore, rawGet, fake, NOW } from "./testKit.mjs";
const admin = await import("../js/admin.js");
const auth = await import("../js/auth.js");
const storage = await import("../js/storage.js");

resetStore();
await auth.ensureSeedAdmin();
const adm = storage.getList("users")[0].userId;
const drv = (await auth.register({ name: "Ali Khan", role: "Driver", password: "secret1", fuelEfficiency: 12 })).user;
const pas = (await auth.register({ name: "Sara Noor", role: "Passenger", password: "secret1" })).user;

group("1 role check");
check("passenger cannot list users", admin.listUsers(pas.userId).length === 0);
check("passenger cannot create users", (await admin.createUser(pas.userId, { name: "X Y", role: "Driver", password: "secret1", fuelEfficiency: 10 }, NOW)).ok === false);
check("passenger cannot update users", (await admin.updateUser(pas.userId, drv.userId, { name: "Hacked" }, NOW)).ok === false);
check("passenger cannot save settings", admin.saveRecommendationSettings(pas.userId, { maxDetourKm: 6, weights: [25, 25, 20, 30], farePerKm: 30, fuelPrice: 280, responseTimeoutMin: 2 }, NOW).ok === false);
check("unknown id is not an admin", admin.listUsers("none").length === 0);
check("administrator lists all users without password data", admin.listUsers(adm).length === 3 && admin.listUsers(adm).every(u => !("passwordHash" in u)));

group("2 create, update, deactivate (UC-11)");
const created = await admin.createUser(adm, { name: "Omar Sheikh", role: "Driver", password: "secret1", fuelEfficiency: 15, vehicleSeats: 3 }, NOW);
check("administrator creates a driver", created.ok && created.user.role === "Driver");
check("administrator can create another administrator", (await admin.createUser(adm, { name: "Admin Two", role: "Administrator", password: "secret1" }, NOW)).ok);
check("invalid input refused with a message", (await admin.createUser(adm, { name: "", role: "Driver", password: "1", fuelEfficiency: 0 }, NOW)).errors.length >= 3);
check("duplicate name refused", !(await admin.createUser(adm, { name: "ali khan", role: "Passenger", password: "secret1" }, NOW)).ok);
const up = await admin.updateUser(adm, drv.userId, { name: "Ali K. Khan", fuelEfficiency: 14 }, NOW);
check("update name and fuel efficiency", up.ok && up.user.name === "Ali K. Khan" && up.user.fuelEfficiency === 14);
check("update with bad fuel efficiency refused", !(await admin.updateUser(adm, drv.userId, { fuelEfficiency: -1 }, NOW)).ok);
check("rename to an existing name refused", !(await admin.updateUser(adm, drv.userId, { name: "Sara Noor" }, NOW)).ok);
check("role change passenger to driver needs fuel efficiency", !(await admin.updateUser(adm, pas.userId, { role: "Driver" }, NOW)).ok);
check("role change with fuel efficiency works", (await admin.updateUser(adm, pas.userId, { role: "Driver", fuelEfficiency: 10 }, NOW)).ok);
await admin.updateUser(adm, pas.userId, { role: "Passenger" }, NOW);
check("driver data removed when role becomes Passenger", !("fuelEfficiency" in storage.getList("users").find(u => u.userId === pas.userId)));
check("password reset works and old password stops working", (await admin.updateUser(adm, drv.userId, { password: "newsecret" }, NOW)).ok && (await auth.login("Ali K. Khan", "newsecret", NOW)).ok && !(await auth.login("Ali K. Khan", "secret1", NOW)).ok);
check("short new password refused", !(await admin.updateUser(adm, drv.userId, { password: "123" }, NOW)).ok);
const dd = await admin.deactivateUser(adm, drv.userId, NOW);
check("deactivate works", dd.ok && dd.user.active === false);
check("deactivated user cannot log in", (await auth.login("Ali K. Khan", "newsecret", NOW)).reason === "deactivated");
check("account can be reactivated", (await admin.updateUser(adm, drv.userId, { active: true }, NOW)).ok && (await auth.login("Ali K. Khan", "newsecret", NOW)).ok);
check("unknown user refused", !(await admin.updateUser(adm, "USR-none", { name: "A B" }, NOW)).ok);
fake.failWrites = true;
check("save failure reported", !(await admin.updateUser(adm, drv.userId, { name: "Zed" }, NOW)).ok);
fake.failWrites = false;
check("all changes audited", ["User account created", "User account updated", "User account deactivated"].every(t => storage.getList("auditLogs").some(e => e.action === t && e.userId === adm)));

group("3 last administrator safeguard (ASSUMPTION)");
resetStore();
await auth.ensureSeedAdmin();
const only = storage.getList("users")[0].userId;
check("cannot deactivate the only administrator", !(await admin.deactivateUser(only, only, NOW)).ok);
check("cannot change the only administrator's role", !(await admin.updateUser(only, only, { role: "Passenger" }, NOW)).ok);
await admin.createUser(only, { name: "Admin Two", role: "Administrator", password: "secret1" }, NOW);
check("with a second administrator it is allowed", (await admin.deactivateUser(only, only, NOW)).ok);

group("4 settings with audit (UC-12)");
resetStore();
await auth.ensureSeedAdmin();
const a2 = storage.getList("users")[0].userId;
const good = { maxDetourKm: 6, weights: [20, 30, 20, 30], farePerKm: 35, fuelPrice: 290, responseTimeoutMin: 3 };
const ok = admin.saveRecommendationSettings(a2, good, NOW);
check("valid settings saved", ok.ok && storage.getSettings().maxDetourKm === 6);
check("change written to audit log", storage.getList("auditLogs").some(e => e.action === "Recommendation settings changed" && e.userId === a2));
const before = rawGet("rr_settings"), logs = storage.getList("auditLogs").length;
const bad = admin.saveRecommendationSettings(a2, { ...good, weights: [20, 30, 20, 31] }, NOW);
check("invalid settings refused, old values kept, no audit entry", !bad.ok && rawGet("rr_settings") === before && storage.getList("auditLogs").length === logs);

finish("js/admin.js");
