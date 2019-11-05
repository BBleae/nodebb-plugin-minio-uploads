<h1><i class="fa fa-picture-o"></i> S3 Uploads Configuration</h1>
<hr/>

<p>
	Asset host and asset path are optional. You can leave these blank to default to the standard asset url -
	http://mybucket.s3.amazonaws.com/uuid.jpg.<br/>
	Asset host can be set to a custom asset host. For example, if set to cdn.mywebsite.com then the asset url is
	http://cdn.mywebsite.com/uuid.jpg.<br/>
	Asset path can be set to a custom asset path. For example, if set to /assets, then the asset url is
	http://mybucket.s3.amazonaws.com/assets/uuid.jpg.<br/>
	If both are asset host and path are set, then the url will be http://cdn.mywebsite.com/assets/uuid.jpg.
</p>

<h3>Instance meta-data</h3>
<p>This plugin is compatible with the instance meta-data API, you'll need to setup role delegation for this to work. See
	the following links:</p>
<ul>
	<li><a href="http://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AESDG-chapter-instancedata.html">EC2 Documentation:
		Instance Metadata and User Data</a></li>
	<li><a href="http://docs.aws.amazon.com/IAM/latest/UserGuide/roles-assume-role.html">IAM Documentation: Assuming a
		Role</a></li>
	<li><a href="http://docs.aws.amazon.com/IAM/latest/UserGuide/role-usecase-ec2app.html">IAM Documentation: EC2 Role
		Example</a></li>
	<li><a href="http://docs.aws.amazon.com/STS/latest/UsingSTS/sts_delegate.html">STS Documentation: Delegation</a>
	</li>
</ul>
<div class="alert alert-warning">
	<p>If you need help, create an <a href="https://github.com/BBleae/nodebb-plugin-minio-uploads/issues/">issue on
		Github</a>.</p>
</div>

<h3>Database Stored configuration:</h3>
<form id="s3-upload-bucket">
	<label for="s3bucket">Bucket</label><br/>
	<input type="text" id="s3bucket" name="bucket" value="{bucket}" title="S3 Bucket" class="form-control input-lg"
	       placeholder="S3 Bucket"><br/>

	<label for="endPoint">End Point</label><br/>
	<input type="text" id="endPoint" name="endPoint" value="{endPoint}" title="End Point" class="form-control input-lg"
	       placeholder="website.com"><br/>

	<label for="s3port">Port</label><br/>
	<input type="text" id="s3port" name="port" value="{port}" title="S3 Port" class="form-control input-lg"
	       placeholder="9000"><br/>

	<label for="s3path">Path</label><br/>
	<input type="text" id="s3path" name="path" value="{path}" title="S3 Path" class="form-control input-lg"
	       placeholder="/nodebb"><br/>

	<label for="usessl">Use SSL</label><br/>
	<select id="usessl" name="usessl" title="Use SSL" class="form-control">
		<option value="true">True</option>
		<option value="false">False</option>
	</select>
	<br/>

	<button class="btn btn-primary" type="submit">Save</button>
</form>

<br><br>
<form id="s3-upload-credentials">
	<label for="bucket">Credentials</label><br/>
	<div class="alert alert-warning">
		Configuring this plugin using the fields below is <strong>NOT recommended</strong>, as it can be a potential
		security issue. We highly recommend that you investigate using either <strong>Environment Variables</strong> or
		<strong>Instance Meta-data</strong>
	</div>
	<input type="text" name="accessKeyId" value="{accessKeyId}" maxlength="20" title="Access Key ID"
	       class="form-control input-lg" placeholder="Access Key ID"><br/>
	<input type="text" name="secretAccessKey" value="{secretAccessKey}" title="Secret Access Key"
	       class="form-control input-lg" placeholder="Secret Access Key"><br/>
	<button class="btn btn-primary" type="submit">Save</button>
</form>

<script>
	$(document).ready(function () {

		$('#aws-region option[value="{region}"]').prop('selected', true)

		$("#s3-upload-bucket").on("submit", function (e) {
			e.preventDefault();
			save("s3settings", this);
		});

		$("#s3-upload-credentials").on("submit", function (e) {
			e.preventDefault();
			var form = this;
			bootbox.confirm("Are you sure you wish to store your credentials for accessing S3 in the database?", function (confirm) {
				if (confirm) {
					save("credentials", form);
				}
			});
		});

		function save(type, form) {
			var data = {
				_csrf: '{csrf}' || $('#csrf_token').val()
			};

			var values = $(form).serializeArray();
			for (var i = 0, l = values.length; i < l; i++) {
				data[values[i].name] = values[i].value;
			}

			$.post('{forumPath}api/admin/plugins/minio-uploads/' + type, data).done(function (response) {
				if (response) {
					ajaxify.refresh();
					app.alertSuccess(response);
				}
			}).fail(function (jqXHR, textStatus, errorThrown) {
				ajaxify.refresh();
				app.alertError(jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Error saving!');
			});
		}
	});
</script>
