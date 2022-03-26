const fs = require("fs");
const path = require("path");
const {dir} = require("tmp-promise");
const {exec} = require("child_process");
const {getOptions} = require("loader-utils");


const readFile = (path, type) => new Promise((resolve, reject) => {
    fs.readFile(path, type, (err, data) => {
        if (err)
            reject(err);
        resolve(data);
    });
});


module.exports = function loader() {
    const callback = this.async();

    const options = getOptions(this);

    const target = this.target;
    const inputFile = this.resourcePath;

    const ext = path.extname(inputFile);
    const fileName = path.basename(inputFile, ext);

    // Whether or not we need to do the compilation
    const compile = (ext === ".cpp" || ext === ".c");

    (async () => {
        // Get path of location of files and optional cleanup function for compilation
        const [filePath, cleanup] = await (async () => {
            if (compile) {
                const {_, path: filePath, cleanup} = await dir({ unsafeCleanup: true });
                return [filePath, cleanup];
            } else {
                const filePath = path.dirname(inputFile);
                return [filePath, () => {}];
            }
        })();

        const jsPath   = `${filePath}/${fileName}.js`;
        const wasmPath = `${filePath}/${fileName}.wasm`;
        const dataPath = `${filePath}/${fileName}.data`;

        const finish = async () => {
            try {
                const data_js = await readFile(jsPath, "utf-8");
                const data_wasm = await readFile(wasmPath, null);
                const data_extra = (fs.existsSync(dataPath) ? await readFile(dataPath, null) : "");

                this.emitFile(`${fileName}.wasm`, data_wasm);
                this.emitFile(`${fileName}.data`, data_extra);

                cleanup();

                // Remove module.exports at end of autogenerated JS file
                //  By removing any text after the end of Module: `})();`
                const data_js_final = data_js.substring(0, 5+data_js.lastIndexOf("})();"));

                // NOTE: You are not allowed to reassign Module
                callback(null, `
                    module.exports = function (data) {
                        ${data_js_final}

                        return Module(data).then((Module) => {
                            const keys = Object.keys(Module);
                            keys.forEach((key) => {
                                if (key.startsWith("_"))
                                    Module[key.substring(1)] = Module[key];
                            });

                            Object.entries(data || {}).forEach(([key, val]) => {
                                Module[key] = val;
                            });
                        });
                    }
                `);
            } catch(e) {
                cleanup();

                callback(e);
            }
        }

        if (!compile) {
            await finish();
            return;
        }

        // -------
        // Perform compilation using em++/emcc
        // -------
        const CPP = (ext === ".cpp");

        const includes = options.includes;
        const data = options.data || [];
        const useGL = options.useGL || false;
        const extraFlags = options.extraFlags || [];
        const exportedFuncs = ["_free", "_malloc", ...(options.exportedFuncs || [])];

        const compiler = CPP ? "em++" : "emcc"

        const flags = ["-s WASM=1",
                        "-s MODULARIZE=1",
                        `${CPP ? "-std=c++11" : ""}`,
                        `-s ENVIRONMENT=${target}`,
                        `-s EXPORTED_FUNCTIONS="[${exportedFuncs.map(s => `'${s}'`).join(",")}]"`,
                        ...(useGL ? ["-lGL", "-lglfw", "-s USE_GLFW=3", "-s USE_WEBGL2=1"] : []),
                        ...includes.map(I => `-I ${I}`),
                        ...data.map(D => `--preload-file ${D}`),
                        ...extraFlags,
                        `-o ${jsPath}`];

        const cmd = `${compiler} ${inputFile} ${flags.join(" ")}`;

        const child = exec(cmd, (err, stdout, stderr) => {
            console.error(stdout);
            console.error(stderr);
        });
        child.on("error", (err) => {
            callback(err);
        });
        child.on("message", (msg) => {
            console.log("MESSAGE: ", msg);
        })
        child.on("exit", async (code) => {
            if (code != 0) {
                callback(`${cmd} failed to run, with exit code ${code}!`);
                return;
            }
            await finish();
        });
    })();
}