var gulp = require('gulp');

// gulp plugins and utils
var gutil = require('gulp-util');
var livereload = require('gulp-livereload');
var nodemon = require('gulp-nodemon');
var postcss = require('gulp-postcss');
var sourcemaps = require('gulp-sourcemaps');
var zip = require('gulp-zip');
var gitignore = require('gulp-gitignore');

// postcss plugins
var autoprefixer = require('autoprefixer');
var colorFunction = require('postcss-color-function');
var cssnano = require('cssnano');
var customProperties = require('postcss-custom-properties');
var easyimport = require('postcss-easy-import');

// dependencies for deployment
var fs = require('fs');
var path = require('path');
var got = require('got');
var FormData = require('form-data');

// Shared variables
var themeZipPath = '.dist';
var themeZipName = require('./package.json').name + '.zip';

var swallowError = function swallowError(error) {
    gutil.log(error.toString());
    gutil.beep();
    this.emit('end');
};

var nodemonServerInit = function () {
    livereload.listen(1234);
};

gulp.task('build', ['css'], function (/* cb */) {
    return nodemonServerInit();
});

gulp.task('css', function () {
    var processors = [
        easyimport,
        customProperties,
        colorFunction(),
        autoprefixer({browsers: ['last 2 versions']}),
        cssnano()
    ];
    gulp.src('assets/css/*.css')
        .on('error', swallowError)
        .pipe(sourcemaps.init())
        .pipe(postcss(processors))
        .pipe(sourcemaps.write('.'))
        .pipe(gulp.dest('assets/built/'))
        .pipe(livereload());
});

gulp.task('watch', function () {
    gulp.watch('assets/css/**', ['css']);
});

gulp.task('default', ['build'], function () {
    gulp.start('watch');
});

/*
 * Deployment tasks
 */
gulp.task('zip', ['css'], function () {
    // Include all files, except node_modules which are large and make this slow
    return gulp.src(['**', '!node_modules/**'])
    // Now also exclude everything mentioned in gitignore
        .pipe(gitignore())
        // Zip up what is left & save it
        .pipe(zip(themeZipName))
        .pipe(gulp.dest(themeZipPath));
});

function doUpload(url, bodyData) {
    return got
        .post(url + '/ghost/api/v0.1/authentication/token', {form: true, body: bodyData})
        .then(function (res) {
            var form = new FormData();

            form.append('theme', fs.createReadStream(path.join(themeZipPath, themeZipName)));

            return got
                .post(url + '/ghost/api/v0.1/themes/upload', {
                    headers: {
                        Authorization: 'Bearer ' + JSON.parse(res.body).access_token
                    },
                    body: form
                })
                .then(function handleSuccess(res) {
                    var theme = JSON.parse(res.body).themes[0];
                    gutil.log(gutil.colors.green('Successfully uploaded: ' + theme.name));
                    if (!theme.active) {
                        gutil.log(gutil.colors.yellow('Warning: ' + theme.name + ' is not the active theme, please activate it to see changes.'));
                    }
                })
                .catch(function handleError(err) {
                    if (err.statusCode === 422) {
                        var response = JSON.parse(err.response.body),
                            error = response.errors[0];

                        gutil.log(gutil.colors.red(error.errorType + ': ' + error.message));

                        if (error.errorDetails && Array.isArray(error.errorDetails)) {
                            gutil.log(gutil.colors.red('ErrorDetails: '));
                            error.errorDetails.forEach(function (details) {
                                gutil.log(details);
                            });
                        }
                    } else {
                        gutil.log(gutil.colors.red('Upload Error: ' + err));
                    }

                    gutil.beep();
                });
        }
        )
        .catch(function (err) {
            gutil.log(gutil.colors.red('Auth Error: ' + err));
            gutil.beep();
        });
}

gulp.task('upload', function () {
    try {
        var deployConfig = require('./gulp-config.json');
        var url = deployConfig.url;
        var bodyData = {
            grant_type: 'password',
            client_id: deployConfig.client_id,
            client_secret: deployConfig.client_secret,
            username: deployConfig.username,
            password: deployConfig.password
        };
    } catch (err) {
        gutil.log(gutil.colors.red('Please copy gulp-config.json.example to gulp-config.json & fill out all of your details'));
    }

    return doUpload(url, bodyData);
});

gulp.task('deploy', ['zip'], function () {
    gulp.start(['upload']);
});
