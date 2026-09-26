## Remnawave Node

Node for Remnawave Panel.

Learn more about Remnawave Panel [here](https://docs.rw/).

## Fedarisha and Selectel

For a Fedarisha inbound with `storage.authType: "selectel-iam"`, set
`storage.masterServiceUserId` to the Selectel IAM ID of the **service user**
that owns `storage.accessKey`. The node verifies the key's owner before it
changes the bucket policy. A panel user's S3 key cannot be used as the master
key here: Selectel only permits panel users to be selected as policy principals
through its control panel, not the S3 policy API.

The generated policy grants this service user bucket listing and object access
under the inbound's base prefix. Each issued client key can list and access
objects only within its own prefix. If `sessionsDir` is omitted, empty, or
`null`, Xray uses `sessions` for both inbound and outbound sessions.

See [Selectel's bucket policy rules](https://docs.selectel.ru/en/s3/buckets/bucket-policy/about-bucket-policy/)
and [service-user S3 credentials](https://docs.selectel.ru/en/access-control/manage/edit-user-data-or-role/).

# Contributors

Check [open issues](https://github.com/remnawave/panel/issues) to help the progress of this project.

<p align="center">
Thanks to the all contributors who have helped improve Remnawave:
</p>
<p align="center">
<a href="https://github.com/remnawave/node/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=remnawave/node" />
</a>
</p>
