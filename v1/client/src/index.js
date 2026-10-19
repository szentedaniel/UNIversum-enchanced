import './index.css'
import './global.css'
import React, { Suspense } from 'react';
import ReactDOM from 'react-dom';
import App from './Components/App';
import { Provider } from 'react-redux';
import store from './Store';
import '@themesberg/flowbite';


import './i18n';
import Loading from './Components/Loading';

ReactDOM.render(
  <React.StrictMode>
    <Provider store={store}>
      <Suspense fallback={<Loading loading={true} />}>
        <App />
      </Suspense>
    </Provider>
  </React.StrictMode>,
  document.getElementById('root')
);

