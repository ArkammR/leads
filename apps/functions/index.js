// Entry point: each handler module exports its Cloud Functions.
Object.assign(
  exports,
  require("./src/handlers/users"),
  require("./src/handlers/products"),
  require("./src/handlers/leads"),
  require("./src/handlers/leadSources"),
  require("./src/handlers/orders"),
  require("./src/handlers/alerts"),
  require("./src/handlers/finance"),
  require("./src/handlers/staff"),
  require("./src/handlers/attendance"),
  require("./src/handlers/workplace"),
  require("./src/handlers/shipping"),
  require("./src/handlers/webhook")
);
