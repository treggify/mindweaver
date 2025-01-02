const fs = require('fs');
const path = require('path');

// Create build directory if it doesn't exist
const buildDir = path.join(__dirname, '..', 'build');
if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir);
}

// Copy manifest.json to build directory
fs.copyFileSync(
    path.join(__dirname, '..', 'manifest.json'),
    path.join(buildDir, 'manifest.json')
);

// Copy styles.css to build directory if it exists
const stylesPath = path.join(__dirname, '..', 'styles.css');
if (fs.existsSync(stylesPath)) {
    fs.copyFileSync(
        stylesPath,
        path.join(buildDir, 'styles.css')
    );
}

// Copy main.js to build directory
const mainJsPath = path.join(__dirname, '..', 'main.js');
if (fs.existsSync(mainJsPath)) {
    fs.copyFileSync(
        mainJsPath,
        path.join(buildDir, 'main.js')
    );
}
