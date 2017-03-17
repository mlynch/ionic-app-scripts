// From Angular CLI
// Dummy preprocessor, just to keep karma from showing a warning.
const preprocessor: any = () => (content: any, _file: string, done: any) => done(null, content);
preprocessor.$inject = [];

// Also export karma-webpack and karma-sourcemap-loader.
module.exports = Object.assign({
  //'framework:@angular/cli': ['factory', init],
  'preprocessor:@ionic/app-scripts': ['factory', preprocessor]
}, require('karma-webpack'), require('karma-sourcemap-loader'));
