"use strict";
var Package = require("./package.json"),
	url = require("url"),
	Minio = require("minio"),
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
	plugin = {},
	MinIOClient = null,
	settings = {
		"accessKeyId": false,
		"secretAccessKey": false,
		"bucket": "nodebb",
		"path": "/nodebb",
		"port": 9000,
		"useSSL": true,
		"endPoint": "s3.amazonaws.com"
	};
	minioSettings = { useSSL: true },
	accessKeyIdFromDb = false;
try {
	(function () {

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

				if (newSettings.accessKeyId) {
					minioSettings.accessKey = newSettings.accessKeyId;
					accessKeyIdFromDb = true;
				} else {
					minioSettings.accessKey = false;
				}

				if (newSettings.secretAccessKey) {
					minioSettings.secretKey = newSettings.secretAccessKey;
				} else {
					minioSettings.secretKey = false;
				}

				if (!newSettings.bucket) {
					minioSettings.bucket = settings.bucket;
				} else {
					minioSettings.bucket = newSettings.bucket;
				}

				if (!newSettings.endPoint) {
					minioSettings.endPoint = settings.endPoint;
				} else {
					minioSettings.endPoint = newSettings.endPoint;
				}

				if (!newSettings.port) {
					minioSettings.port = settings.port;
				} else {
					minioSettings.port = Number(newSettings.port);
				}

				if (!newSettings.useSSL) {
					minioSettings.useSSL = true;
				} else {
					minioSettings.useSSL = (newSettings.useSSL == "true");
				}

				if (!newSettings.path) {
					minioSettings.path = "/nodebb";
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

			winston.error(err.stack);
			return err;
		}

		plugin.activate = function (data) {
			if (data.id === "nodebb-plugin-minio-uploads") {
				fetchSettings();
			}

		};

		plugin.deactivate = function (data) {
			if (data.id === "nodebb-plugin-minio-uploads") {
				MinIOClient = null;
			}
		};

		plugin.load = function (params, callback) {
			fetchSettings(function (err) {
				if (err) {
					return winston.error(err.message);
				}
				adminRoute = "/admin/plugins/minio-uploads",

					params.router.get(adminRoute, params.middleware.applyCSRF, params.middleware.admin.buildHeader, renderAdmin);
				params.router.get("/api" + adminRoute, params.middleware.applyCSRF, renderAdmin);

				params.router.post("/api" + adminRoute + "/s3settings", s3settings);
				params.router.post("/api" + adminRoute + "/credentials", credentials);

				callback();
			});
		};

		function renderAdmin(req, res) {
			token = req.csrfToken(),

				forumPath = nconf.get("url"),
			if (forumPath.split("").reverse()[0] != "/") {
				forumPath = forumPath + "/";
			}
			var data = {
				bucket: minioSettings.bucket,
				endPoint: minioSettings.endPoint,
				path: minioSettings.path,
				forumPath: forumPath,
				accessKeyId: (accessKeyIdFromDb && minioSettings.accessKeyId) || "",
				secretAccessKey: (accessKeyIdFromDb && minioSettings.secretAccessKey) || "",
				csrf: token
			};

			res.render("admin/plugins/minio-uploads", data);
		}

		function s3settings(req, res, next) {
			data = req.body,
			var newSettings = {
				bucket: data.bucket || "",
				endPoint: data.endPoint || "",
				path: data.path || "",
				port: data.port || 9000,
				useSSL: data.useSSL || true
			};
			saveSettings(newSettings, res, next);
		}

		function credentials(req, res, next) {
			data = req.body,
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
			winston.info("start uploading img");
			image = data.image,

			if (!image) {
				winston.error("invalid image");
				return callback(makeError("invalid image"));
			}

			//check filesize vs. settings
			if (image.size > parseInt(meta.config.maximumFileSize, 10) * 1024) {
				winston.error("error:file-too-big, " + meta.config.maximumFileSize);
				return callback(makeError("[[error:file-too-big, " + meta.config.maximumFileSize + "]]"));
			}

			type = image.url ? "url" : "file",
				allowedMimeTypes = ["image/png", "image/jpeg", "image/gif"],

			if (type === "file") {
				if (!image.path) {
					return callback(makeError("invalid image path"));
				}

				if (allowedMimeTypes.indexOf(mime.getType(image.path)) === -1) {
					return callback(makeError("invalid mime type"));
				}

				fs.readFile(image.path, function (err, buffer) {
					uploadToS3(image.name, err, buffer, callback);
				});
			}
			else {
				if (allowedMimeTypes.indexOf(mime.getType(image.url)) === -1) {
					return callback(makeError("invalid mime type"));
				}
				filename = image.url.split("/").pop(),

					imageDimension = parseInt(meta.config.profileImageDimension, 10) || 128,

					// Resize image.
					im(request(image.url), filename)
						.resize(imageDimension + "^", imageDimension + "^")
						.stream(function (err, stdout) {
							if (err) {
								return callback(makeError(err));
							}

							// This is sort of a hack - We"re going to stream the gm output to a buffer and then upload.
							// See https://github.com/aws/aws-sdk-js/issues/94
							buf = new Buffer(0),
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
			file = data.file,

			if (!file) {
				return callback(makeError("invalid file"));
			}

			if (!file.path) {
				return callback(makeError("invalid file path"));
			}

			//check filesize vs. settings
			if (file.size > parseInt(meta.config.maximumFileSize, 10) * 1024) {
				winston.error("error:file-too-big, " + meta.config.maximumFileSize);
				return callback(makeError("[[error:file-too-big, " + meta.config.maximumFileSize + "]]"));
			}

			fs.readFile(file.path, function (err, buffer) {
				uploadToS3(file.name, err, buffer, callback);
			});
		};

		function uploadToS3(filename, err, buffer, callback) {
			winston.info("start uploading to MinIO");
			if (err) {
				return callback(makeError(err));
			}

			s3Path,
			if (minioSettings.path && 0 < minioSettings.path.length) {
				s3Path = minioSettings.path;

				if (!s3Path.match(/\/$/)) {
					// Add trailing slash
					s3Path = s3Path + "/";
				}
			}
			else {
				s3Path = "/";
			}

			s3KeyPath = s3Path.replace(/^\//, ""), // S3 Key Path should not start with slash.

			var params = {
				Bucket: minioSettings.bucket,
				ACL: "public-read",
				Key: uuidv4() + path.extname(filename),
				Body: buffer,
				ContentLength: buffer.length,
				ContentType: mime.getType(filename)
			};
			winston.info("start putting object");
			MC().putObject(params.Bucket, params.Key, params.Body, params.Body.byteLength, params.ContentType ? { "Content-Type": params.ContentType } : {}, function (err) {
				if (err) {
					return callback(makeError(err));
				}

				// amazon has https enabled, we use it by default
				endPoint = "https://" + params.Bucket + ".s3.amazonaws.com",
				if (minioSettings.endPoint && 0 < minioSettings.endPoint.length) {
					endPoint = minioSettings.endPoint;
					// endPoint must start with http or https
					if (!endPoint.startsWith("http")) {
						if (minioSettings.useSSL) {
							endPoint = "https://" + endPoint;
						}
						else {
							endPoint = "http://" + endPoint;
						}
					}
				}
				winston.info("uploaded img");
				winston.info(filename + ": " + url.resolve(endPoint, s3KeyPath + params.Key));

				callback(null, {
					name: filename,
					url: url.resolve(endPoint, s3KeyPath + params.Key)
				});
			});
		}

		admin = plugin.admin = {},

			admin.menu = function (custom_header, callback) {
				custom_header.plugins.push({
					"route": "/plugins/minio-uploads",
					"icon": "fa-envelope-o",
					"name": "MinIO Uploads"
				});

				callback(null, custom_header);
			};

		module.exports = plugin;

	})();
} catch (e) { winston.error(e); }
