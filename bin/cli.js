#!/usr/bin/env node
"use strict";
const program = require('commander');
const moment = require("moment");
const ContribCat = require("./../lib/index");
const config = require("./../config");

function collectRepos(val, repos) {
    repos.push(val);
    return repos;
}

program
    .version("0.0.1")
    .option("-m, --mode <mode>", "ContribCat Mode [complete]", /^(load|sync)$/i, "all")
    .option("-d, --days <n>", "Load/Sync Days", 1)
    .option('-r, --repos [value]', 'List repositories to filter to e.g. ["org/repo:branch"]', collectRepos, [])
    .parse(process.argv);

const mode = program.mode;
const days = program.days;
const fromDate = moment.utc().startOf("day").subtract(days, "days");

if (program.repos.length > 0) {
    config.repos = program.repos;
}

const contribCat = new ContribCat(config);

switch(mode) {
    case "load":
        console.log("Load contribution data from", fromDate.toString());
        contribCat.load(fromDate)
            .then(contribCat.disconnect.bind(contribCat))
            .finally(() => {
                console.log("Operation Completed");
            });
        break;
    case "sync":
        console.log("Sync contribution data from", fromDate.toString());
        contribCat.sync(fromDate)
            .then(contribCat.disconnect.bind(contribCat))
            .finally(() => {
                console.log("Operation Completed");
            });
        break;
    default:
        console.log("Load & sync contribution data from", fromDate.toString());
        contribCat.load(fromDate)
            .then(contribCat.sync.bind(contribCat))
            .then(contribCat.disconnect.bind(contribCat))
            .finally(() => {
                console.log("Operation Completed");
            });
        break;
}
