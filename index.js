
const Gauge = require('gauge');
const moment = require('moment');
const conf = require('npm-conf')();
const rimraf = require('rimraf');
const { green } = require('chalk').default;
const { packument } = require('pacote');
const { join } = require('path');
const { promisify } = require('util');
const { mkdirSync } = require('fs');
const { filter } = require('bluebird');
const { create } = require('tar');
const { resolveDependencies, downloadPackages } = require('npm-offline-packager');
const { cache } = require('npm-offline-packager/lib/cache');
const { CronJob } = require('cron');

const rimrafPromise = promisify(rimraf);
const pacoteCacheFolder = process.env.CACHE_FOLDER || join(conf.get('cache'), '_cacache');

start(true);
function start(runOnInit) {
    const job = new CronJob({
        cronTime: process.env.CRON_TIME || '0 0 8 * * *',
        start: false,
        runOnInit,
        onTick: startJob,
    });

    job.start();
}

async function startJob() {
    const startTime = moment();
    console.log('NPM cron job start ', startTime.format('DD/MM/YYYY hh:mm:ss'));

    const destFolder = startTime.format('MMDDYYYY.HHmmss');

    try {
        // Logger function for progress bar
        const gauge = new Gauge();
        const logger = (message, percent = 0) => {
            gauge.show(message, percent);
        };

        // Get new packages from cache
        const newPackages = await getNewPackages({ logger });

        gauge.hide();
        console.log(green(`Get new packages completed with ${Object.keys(newPackages).length} new packages`));

        // Resolve dependencies tree
        const dependencies = await resolveDependencies({ dependencies: newPackages }, { logger });
        gauge.hide();
        console.log(green(`Resolving dependencies completed with ${dependencies.length} packages`));

        // Create dest folder
        mkdirSync(destFolder);

        // Download packages
        const result = await downloadPackages(dependencies, { destFolder, useCache: true, logger });
        const inCachePackages = dependencies.length - result.length;
        const completedPackages = result.filter(inspection => inspection.isFulfilled());
        const displayAmount = completedPackages.length === result.length ? result.length : `${completedPackages.length}/${result.length}`;

        gauge.disable();
        console.log(green(`Fetching packages completed with ${displayAmount} packages ${inCachePackages ? `(${inCachePackages} packages already in cache)` : ''}`));

        // Create packages tar
        await create({ file: `${destFolder}.tar` }, [destFolder]);
        await rimrafPromise(destFolder);

        const endTime = moment();
        const duration = moment.duration(endTime.diff(startTime));

        const hours = duration.hours();
        const minutes = duration.minutes();
        const seconds = duration.seconds();
        const milliseconds = duration.milliseconds();
        console.log(green(`      Duration: ${hours < 10 ? `0${hours}` : hours}:${minutes < 10 ? `0${minutes}` : minutes}:${seconds < 10 ? `0${seconds}` : seconds}:${milliseconds}`));
    } catch (error) {
        console.error(error);
    }
}

/**
 * Get all packages from cache
 *
 * @returns {Promise<object>}
 */
function getNewPackages(options) {
    const logger = options.logger || (() => { });

    return new Promise((resolve, reject) => {
        cache.db.find({}, async (err, docs) => {
            try {
                if (err) {
                    return reject(err);
                }

                let counter = 0;
                const filterPackages = await filter(docs, async ({ packageName, versions }) => {
                    const currPackument = await packument(packageName, { cache: pacoteCacheFolder });
                    const percent = ++counter / docs.length;
                    const { latest } = currPackument['dist-tags'];
                    logger(`Get new packages: ${packageName}@${latest}`, percent);

                    return !versions.includes(latest);
                });

                const packagesObj = filterPackages.reduce((obj, currPackage) => {
                    obj[currPackage.packageName] = 'latest';

                    return obj;
                }, {});

                resolve(packagesObj);
            } catch (error) {
                reject(error);
            }
        });
    });
}
