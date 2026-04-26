#!/usr/bin/env node

require("ts-node/register");
require("tsconfig-paths/register");

const { writeAllSnapshots } = require("../tests/compatibility/public_surface");

writeAllSnapshots()
  .then(() => {
    console.log("Updated public surface compatibility snapshots.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
