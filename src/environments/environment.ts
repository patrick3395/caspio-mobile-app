// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  caspio: {
    tokenEndpoint: 'https://c2hcf092.caspio.com/oauth/token',
    apiBaseUrl: 'https://c2hcf092.caspio.com/rest/v3',
    clientId: '01ddeb9d873748255f3edeccb5fbfa806695e43ffa5fff4f67',
    clientSecret: '1d4e3ea85a2247f0929a0a995df66e6be183c463391375ae80'
  }
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
