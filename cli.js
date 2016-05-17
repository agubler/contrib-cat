#!/usr/bin/env node
"use strict";
const program = require('commander');
const moment = require("moment");

const ContribCat = require("./lib");

let config = require("./config");

program
    .version("0.0.1")
    .option("-m, --mode <mode>", "ContribCat Mode [complete]", /^(load|sync)$/i, "all")
    .option("-d, --days <n>", "Load/Sync Days", 1)
    .parse(process.argv);

var contribCat = new ContribCat(config);

const mode = program.mode;
const days = program.days;

const fromDate = moment.utc().startOf("day").subtract(days, "days");

switch(mode) {
    case "load":
        console.log("Load contribution data from date", fromDate.toString());
        contribCat.load(fromDate)
            .then(contribCat.disconnect.bind(contribCat))
            .finally(() => {
                console.log("Operation Completed");
            });
        break;
    case "sync":
        console.log("Sync contribution data from date", fromDate.toString());
        contribCat.sync(fromDate)
            .then(contribCat.disconnect.bind(contribCat))
            .finally(() => {
                console.log("Operation Completed");
            });
        break;
    default:
        console.log("Load & sync contribution data from date", fromDate.toString());
        contribCat.load(fromDate)
            .then(contribCat.sync.bind(contribCat))
            .then(contribCat.disconnect.bind(contribCat))
            .finally(() => {
                console.log("Operation Completed");
            });
        break;
}
