# add-on-sdk

SDK for implementing Fusebit Add-Ons

## Running tests

Here are a few things you need to know before running tests:

-   You must have access to a [Fusebit](https://fusebit.io) subscription.
-   You must have the [Fusebit CLI](https://fusebit.io/docs/reference/fusebit-cli/) installed.
-   You must have a Fusebit CLI profile configured with an account ID and subscription ID, and sufficient permissions to manage all functions and all storage on that subscription.
-   The test will create and remove functions in randomly named boundary in the subscription.
-   The test will create and remove storage objects in randomly named storage ID in the subscription.

To run the tests, set the `FUSE_PROFILE` environment variable to the Fusebit CLI profile name to use:

```
FUSE_PROFILE={profile-name} npm test
```

In case of a failure, you can get useful, verbose diagnostic information with:

```
debug=1 FUSE_PROFILE={profile-name} npm test
```

## Release Notes

### v3.1.0

-   Add support for converting an Express app to a Fusebit Function

### v3.0.3

-   Fix bug in parameter processing in the storage client

### v3.0.2

-   Allow turning off debugging by setting `debug=0` in the configuration of the function
