import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux'
import Modal from 'react-modal';
import Cookies from 'universal-cookie';
import { LANGUAGES, COLOR_THEMES } from '../config'
import 'flag-icons/css/flag-icons.min.css'
import resolveConfig from 'tailwindcss/resolveConfig'


const cookies = new Cookies();

const customStyles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)'
  },
  content: {
    top: '50%',
    left: '50%',
    right: 'auto',
    bottom: 'auto',
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)',
    border: `4px solid black`,
    background: '#3b2f44',//fullConfig.theme.colors.sajat[100], //COLOR_THEMES[1].dark,

    overflow: 'auto',

    WebkitOverflowScrolling: 'touch',
    borderRadius: '1rem',
    outline: 'none',
    padding: '20px'
  },
}
Modal.setAppElement(document.getElementById('root'));


const LangSelector = () => {
  const { t, i18n } = useTranslation();
  const { isGame } = useSelector((state) => state.loading)
  const { language } = useSelector(state => state.user)
  const [selectedLang, setSelectedLang] = useState(cookies.get('i18next') || language);
  const [modalIsOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setSelectedLang(language)
  }, []);




  const changeLanguage = (lang) => {
    //console.log(LANGUAGES)
    setSelectedLang(lang);
    let tenYearFromNow = new Date();
    tenYearFromNow.setFullYear(tenYearFromNow.getFullYear() + 10);
    cookies.set('i18next', lang, { path: '/', expires: tenYearFromNow });
    //console.log(cookies.get('myCat'));
    i18n.changeLanguage(lang);
    closeModal()
  }

  const openModal = () => {
    setSelectedLang(cookies.get('i18next'))
    setIsOpen(true);
  }

  const afterOpenModal = () => {
    // references are now sync'd and can be accessed.
    //subtitle.style.color = '#f00';
  }

  const closeModal = () => {
    setIsOpen(false);
  }

  const handleLangSelect = (lang) => {
    setSelectedLang(lang)
  }

  return (

    <>
      {!(isGame) &&
        <>

          <div onClick={openModal}
            className='
      min-w-[70px] 
      p-2 
      top-5 
      left-5 
      xs:top-0
      xs:left-0
      flex 
      flex-row 
      uppercase 
      items-center 
      absolute
      xs:relative
      cursor-pointer 
      bg-[#2e2e2e67] 
      border-2 
      border-solid 
      border-sajat-100 
      rounded-lg'>
            <svg xmlns="http://www.w3.org/2000/svg" className="mr-2 icon icon-tabler icon-tabler-world" width="24" height="24"
              viewBox="0 0 24 24" strokeWidth="1.5" stroke='#d1d6d4' fill="none" strokeLinecap="round"
              strokeLinejoin="round">
              <path stroke="none" d="M0 0h24v24H0z" fill="none" />
              <circle cx="12" cy="12" r="9" />
              <line x1="3.6" y1="9" x2="20.4" y2="9" />
              <line x1="3.6" y1="15" x2="20.4" y2="15" />
              <path d="M11.5 3a17 17 0 0 0 0 18" />
              <path d="M12.5 3a17 17 0 0 1 0 18" />
            </svg>
            <p className='flex-1 text-center uppercase text-sajat-100 '>{i18n.language}</p>
          </div>

          <Modal isOpen={modalIsOpen} onAfterOpen={afterOpenModal} onRequestClose={closeModal} style={customStyles}
            contentLabel="Example Modal">

            <div className="relative bg-sajat-900 rounded-lg shadow dark:bg-gray-700">

              <div className="flex justify-between items-center p-5 rounded-t dark:border-gray-600">
                <h3 className="text-xl font-medium text-white">
                  {t('language_selector')}
                </h3>
                <button onClick={closeModal} type="button"
                  className="text-gray-400 bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm p-1.5 ml-auto inline-flex items-center dark:hover:bg-gray-600 dark:hover:text-white"
                  data-modal-toggle="default-modal">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"></path>
                  </svg>
                </button>
              </div>

              <div
                className="rounded-lg bg-sajat-400 w-full mx-auto py-5 xs:grid sm:grid md:grid lg:grid xl:grid 2xl:grid 2xl:grid-cols-3 lg:grid-cols-3 md:grid-cols-3 xs:grid-cols-1 sm:grid-cols-1 xl:grid-cols-3 px-10 overflow-y-auto max-h-96 scrollbar">
                {(LANGUAGES.map(lang => {
                  if (lang.code === selectedLang) {
                    return (<div key={lang.code} className="bg-sajat-200 hover:bg-sajat-200 ring ring-sajat-800 p-3 shadow-md rounded-md m-3 max-h-[4rem] flex flex-col" onClick={() => { handleLangSelect(lang.code) }}>
                      <h3 className="text-center text-xl text-gray-800 font-semibold pr-3"><span className={`rounded-sm fi
                fi-${lang.countryCode} m-2`}></span> {lang.name}</h3>
                    </div>)
                  } else {
                    return (<div key={lang.code} className="bg-sajat-100 hover:bg-sajat-200 p-3 shadow-md rounded-md m-3 max-h-[4rem]" onClick={() => { handleLangSelect(lang.code) }}>
                      <h3 className="text-center text-xl text-gray-800 font-semibold pr-3"><span className={`rounded-sm fi
                fi-${lang.countryCode} m-2`}></span> {lang.name}</h3>
                    </div>)
                  }
                }))}

              </div>

              <div className="flex items-center justify-center p-6 space-x-2 rounded-b border-gray-200 dark:border-gray-600">
                <button onClick={() => { changeLanguage(selectedLang) }} type="button"
                  className="text-white bg-sajat-700 hover:bg-sajat-900 focus:ring-4 focus:ring-sajat-300 font-medium rounded-lg
            text-sm px-5 py-2.5 text-center dark:bg-sajat-600 dark:hover:bg-sajat-700 dark:focus:ring-sajat-800">Mentés</button>
              </div>
            </div>

          </Modal>
        </>
      }
    </>
  )
}

export default LangSelector;