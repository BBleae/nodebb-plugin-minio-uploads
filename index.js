var Package = require("./package.json");

var Minio = require("minio"),
	mime = require("mime"),
	uuidv4 = require("uuid/v4"),
	fs = require("fs"),
	request = require("request"),
	path = require("path"),
	winston = module.parent.require("winston"),
	nconf = module.parent.require("nconf"),
	gm = require("gm"),
	im = gm.subClass({ imageMagick: true }),
	meta = require.main.require("./src/meta"),
	db = require.main.require("./src/database");

var plugin = {}

"use strict";

var S3Conn = null;
var MinIOClient = null;
var settings = {
	"accessKeyId": false,
	"secretAccessKey": false,
	"bucket": process.env.S3_UPLOADS_BUCKET || undefined,
	"host": process.env.S3_UPLOADS_HOST || "s3.amazonaws.com",
	"path": process.env.S3_UPLOADS_PATH || undefined,
	"port": process.env.S3_UPLOADS_PORT || 9000,
	"useSSL": (process.env.S3_UPLOADS_USE_SSL=='true') || true,
	"endPoint": process.env.S3_UPLOADS_HOST || "s3.amazonaws.com"
};
var minioSettings = { useSSL: true }

var accessKeyIdFromDb = false;
var secretAccessKeyFromDb = false;

function fetchSettings(callback) {
	db.getObjectFields(Package.name, Object.keys(settings), function (err, newSettings) {
		if (err) {
			winston.error(err.message);
			if (typeof callback === "function") {
				callback(err);
			}
			return;
		}

		accessKeyIdFromDb = false;
		secretAccessKeyFromDb = false;

		if (newSettings.accessKeyId) {
			minioSettings.accessKey = newSettings.accessKeyId;
			accessKeyIdFromDb = true;
		} else {
			minioSettings.accessKey = false;
		}

		if (newSettings.secretAccessKey) {
			minioSettings.secretKey = newSettings.secretAccessKey;
			secretAccessKeyFromDb = false;
		} else {
			minioSettings.secretKey = false;
		}

		if (!newSettings.bucket) {
			minioSettings.bucket = process.env.S3_UPLOADS_BUCKET || "";
		} else {
			minioSettings.bucket = newSettings.bucket;
		}

		if (!newSettings.host) {
			minioSettings.endPoint = process.env.S3_UPLOADS_HOST || "";
		} else {
			minioSettings.endPoint = newSettings.host;
		}

		if (!newSettings.port) {
			minioSettings.port = process.env.S3_UPLOADS_PORT || 9000;
		} else {
			minioSettings.port = Number(newSettings.port);
		}

		if (!newSettings.useSSL) {
			minioSettings.useSSL = (process.env.S3_UPLOADS_USE_SSL=='true') || 9000;
		} else {
			minioSettings.useSSL = (newSettings.useSSL=='true');
		}

		if (!newSettings.path) {
			minioSettings.path = process.env.S3_UPLOADS_PATH || "";
		} else {
			minioSettings.path = newSettings.path;
		}

		if (settings.accessKeyId && settings.secretAccessKey) {

			Object.assign(minioSettings, {
				accessKeyId: settings.accessKeyId,
				secretAccessKey: settings.secretAccessKey
			});
		}

		if (typeof callback === "function") {
			callback();
		}
	});
}

function MC() {
	if (!MinIOClient) {
		MinIOClient = new Minio.Client(minioSettings);
	}

	return MinIOClient;
}

function makeError(err) {
	if (err instanceof Error) {
		err.message = Package.name + " :: " + err.message;
	} else {
		err = new Error(Package.name + " :: " + err);
	}

	winston.error(err.message);
	return err;
}

plugin.activate = function (data) {
	if (data.id === "nodebb-plugin-minio-uploads") {
		fetchSettings();
	}

};

plugin.deactivate = function (data) {
	if (data.id === "nodebb-plugin-minio-uploads") {
		S3Conn = null;
	}
};

plugin.load = function (params, callback) {
	fetchSettings(function (err) {
		if (err) {
			return winston.error(err.message);
		}
		var adminRoute = "/admin/plugins/minio-uploads";

		params.router.get(adminRoute, params.middleware.applyCSRF, params.middleware.admin.buildHeader, renderAdmin);
		params.router.get("/api" + adminRoute, params.middleware.applyCSRF, renderAdmin);

		params.router.post("/api" + adminRoute + "/s3settings", s3settings);
		params.router.post("/api" + adminRoute + "/credentials", credentials);

		callback();
	});
};

function renderAdmin(req, res) {
	// Regenerate csrf token
	var token = req.csrfToken();

	var forumPath = nconf.get("url");
	if (forumPath.split("").reverse()[0] != "/") {
		forumPath = forumPath + "/";
	}
	var data = {
		bucket: settings.bucket,
		host: settings.host,
		path: settings.path,
		forumPath: forumPath,
		accessKeyId: (accessKeyIdFromDb && settings.accessKeyId) || "",
		secretAccessKey: (accessKeyIdFromDb && settings.secretAccessKey) || "",
		csrf: token
	};

	res.render("admin/plugins/minio-uploads", data);
}

function s3settings(req, res, next) {
	var data = req.body;
	var newSettings = {
		bucket: data.bucket || "",
		endPoint: data.host || "",
		path: data.path || "",
		port: data.port || 9000,
		useSSL: data.useSSL || true
	};
	saveSettings(newSettings, res, next);
}

function credentials(req, res, next) {
	var data = req.body;
	var newSettings = {
		accessKeyId: data.accessKeyId || "",
		secretAccessKey: data.secretAccessKey || ""
	};

	saveSettings(newSettings, res, next);
}

function saveSettings(settings, res, next) {
	db.setObject(Package.name, settings, function (err) {
		if (err) {
			return next(makeError(err));
		}

		fetchSettings();
		res.json("Saved!");
	});
}

plugin.uploadImage = function (data, callback) {
	var image = data.image;

	if (!image) {
		winston.error("invalid image");
		return callback(new Error("invalid image"));
	}

	//check filesize vs. settings
	if (image.size > parseInt(meta.config.maximumFileSize, 10) * 1024) {
		winston.error("error:file-too-big, " + meta.config.maximumFileSize);
		return callback(new Error("[[error:file-too-big, " + meta.config.maximumFileSize + "]]"));
	}

	var type = image.url ? "url" : "file";
	var allowedMimeTypes = ["image/png", "image/jpeg", "image/gif"];

	if (type === "file") {
		if (!image.path) {
			return callback(new Error("invalid image path"));
		}

		if (allowedMimeTypes.indexOf(mime.getType(image.path)) === -1) {
			return callback(new Error("invalid mime type"));
		}

		fs.readFile(image.path, function (err, buffer) {
			uploadToS3(image.name, err, buffer, callback);
		});
	}
	else {
		if (allowedMimeTypes.indexOf(mime.getType(image.url)) === -1) {
			return callback(new Error("invalid mime type"));
		}
		var filename = image.url.split("/").pop();

		var imageDimension = parseInt(meta.config.profileImageDimension, 10) || 128;

		// Resize image.
		im(request(image.url), filename)
			.resize(imageDimension + "^", imageDimension + "^")
			.stream(function (err, stdout, stderr) {
				if (err) {
					return callback(makeError(err));
				}

				// This is sort of a hack - We"re going to stream the gm output to a buffer and then upload.
				// See https://github.com/aws/aws-sdk-js/issues/94
				var buf = new Buffer(0);
				stdout.on("data", function (d) {
					buf = Buffer.concat([buf, d]);
				});
				stdout.on("end", function () {
					uploadToS3(filename, null, buf, callback);
				});
			});
	}
};

plugin.uploadFile = function (data, callback) {
	var file = data.file;

	if (!file) {
		return callback(new Error("invalid file"));
	}

	if (!file.path) {
		return callback(new Error("invalid file path"));
	}

	//check filesize vs. settings
	if (file.size > parseInt(meta.config.maximumFileSize, 10) * 1024) {
		winston.error("error:file-too-big, " + meta.config.maximumFileSize);
		return callback(new Error("[[error:file-too-big, " + meta.config.maximumFileSize + "]]"));
	}

	fs.readFile(file.path, function (err, buffer) {
		uploadToS3(file.name, err, buffer, callback);
	});
};

function uploadToS3(filename, err, buffer, callback) {
	if (err) {
		return callback(makeError(err));
	}

	var s3Path;
	if (settings.path && 0 < settings.path.length) {
		s3Path = settings.path;

		if (!s3Path.match(/\/$/)) {
			// Add trailing slash
			s3Path = s3Path + "/";
		}
	}
	else {
		s3Path = "/";
	}

	var s3KeyPath = s3Path.replace(/^\//, ""); // S3 Key Path should not start with slash.

	var params = {
		Bucket: settings.bucket,
		ACL: "public-read",
		Key: s3KeyPath + uuidv4() + path.extname(filename),
		Body: buffer,
		ContentLength: buffer.length,
		ContentType: mime.getType(filename)
	};

	MC().putObject(params.Bucket, params.Key, params.Body, params.Body.byteLength, params.ContentType, function (err) {
		if (err) {
			return callback(makeError(err));
		}

		// amazon has https enabled, we use it by default
		var host = "https://" + params.Bucket + ".s3.amazonaws.com";
		if (settings.host && 0 < settings.host.length) {
			host = settings.host;
			// host must start with http or https
			if (!host.startsWith("http")) {
				host = "http://" + host;
			}
		}

		callback(null, {
			name: filename,
			url: host + "/" + params.Key
		});
	});
}

var admin = plugin.admin = {};

admin.menu = function (custom_header, callback) {
	custom_header.plugins.push({
		"route": "/plugins/minio-uploads",
		"icon": "fa-envelope-o",
		"name": "MinIO Uploads"
	});

	callback(null, custom_header);
};

module.exports = plugin;
