const { createApp } = require("./app");
if (process.env.NODE_ENV === "production") {
  throw new Error("Production startup is disabled until release access controls are reviewed.");
}
const { app, db } = createApp({
  databasePath: process.env.CRM_DATABASE_PATH,
  imageConfig: process.env.CRM_ENABLE_LIVE_AI === "true" ? undefined : {}
});
const server = app.listen(Number(process.env.PORT || 3183), "127.0.0.1", () => {
  console.log("Divinenet CRM local review: http://127.0.0.1:" + server.address().port);
});
server.once("error", error => {
  db.close();
  console.error(error.code === "EADDRINUSE" ? "Port is occupied. Stop your other review server or select another PORT." : "The review server could not start.");
  process.exitCode = 1;
});
function stop() { server.close(() => { db.close(); process.exit(0); }); }
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
