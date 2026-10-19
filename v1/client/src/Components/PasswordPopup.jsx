import React, { useEffect, useState } from 'react';
import Modal from 'react-modal';
import { useTranslation } from 'react-i18next';
import { COLOR_THEMES } from '../config'
import { Link } from 'react-router-dom';


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
    background: COLOR_THEMES[1].dark,

    overflow: 'auto',

    WebkitOverflowScrolling: 'touch',
    borderRadius: '1rem',
    outline: 'none',
    padding: '20px'
  },
}
Modal.setAppElement(document.getElementById('root'));

export default function PasswordPopup({ showPasswordPopup = false, setPw, setShowPasswordPopup }) {

  const [modalIsOpen, setIsOpen] = useState(false);
  const [password, setPassword] = useState(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (showPasswordPopup) openModal()
    //console.log('inside popup show: ', showPasswordPopup);
  }, [showPasswordPopup]);



  const openModal = () => {
    setIsOpen(true);
  }

  const afterOpenModal = () => {
    // references are now sync'd and can be accessed.
    //subtitle.style.color = '#f00';
    console.log('OPEN_: ', { showPasswordPopup: { kulso: showPasswordPopup, belso: modalIsOpen } })
  }

  const closeModal = () => {
    setPw(password)
    setIsOpen(false)
    setShowPasswordPopup(false);
    console.log('CLOSE_: ', { pw: password, showPasswordPopup: { kulso: false, belso: false } })
  }

  const applyModal = () => {
    if (password !== null) {
      setPw(password)
      setIsOpen(false)
      setShowPasswordPopup(false);
    }
    console.log('APPLY_: ', { pw: password, showPasswordPopup: { kulso: false, belso: false } })
  }

  return (
    <>{showPasswordPopup &&
      <>
        <Modal isOpen={showPasswordPopup} onAfterOpen={afterOpenModal} onRequestClose={closeModal} style={customStyles}
          contentLabel="Example Modal">

          <div className="relative bg-sajat-900 rounded-lg shadow dark:bg-gray-700">

            <div className="flex justify-between items-center p-5 rounded-t border-b dark:border-gray-600">
              <h3 className="text-xl font-medium text-white">
                {t('language_selector')}
              </h3>
              <Link to='/'>
                <button onClick={closeModal} type="button"
                  className="text-gray-400 bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm p-1.5 ml-auto inline-flex items-center dark:hover:bg-gray-600 dark:hover:text-white"
                  data-modal-toggle="default-modal">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"></path>
                  </svg>
                </button>
              </Link>
            </div>

            <div className="flex justify-center">
              <div className="mb-3 xl:w-96">
                <label htmlFor="examplePassword0" className="form-label inline-block mb-2 text-gray-700">
                  Password input
                </label>
                <input
                  type="password"
                  className="
                    form-control
                    block
                    w-full
                    px-3
                    py-1.5
                    text-base
                    font-normal
                    text-gray-700
                    bg-white bg-clip-padding
                    border border-solid border-gray-300
                    rounded
                    transition
                    ease-in-out
                    m-0
                    focus:text-gray-700 focus:bg-white focus:border-blue-600 focus:outline-none"
                  id="examplePassword0"
                  placeholder="Password input"
                  onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center p-6 space-x-2 rounded-b border-t border-gray-200 dark:border-gray-600">
              <button onClick={applyModal} type="button"
                className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg
            text-sm px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800">I
                accept</button>
            </div>
          </div>

        </Modal>




      </>
    }

    </>);
}
